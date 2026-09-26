import type { Card } from '../types'
import { displayName, isCreature, isLand } from '../cardDb'
import {
  canAttack, canBlock, cast, checkState, uid, creatureValue, declareAttack, draw, endTurn, isPermanentCard, kw, landColorsFor, parseCost, payment, playLand, power, say, toughness,
  type GameState, type Perm,
} from './engine'

// The bot's brain: simple, readable heuristics. It reads a handful of effects
// straight from oracle text (removal, burn, bounce, draw, lifegain, tokens,
// wipes, mill) and plays everything else as a vanilla permanent.

export type BotStep = { kind: 'action' } | { kind: 'await-blocks' }

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, x: 0 }
const n = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()] ?? 0)

let tokenSeq = 1
function token(p: number, t: number, colors: Card['colors']): Card {
  return {
    id: `token-${tokenSeq++}`, oracleId: 'token', name: `${p}/${t} Token`, set: '', setName: 'Token', collectorNumber: '', rarity: 'common', manaCost: '', cmc: 0,
    colors, colorIdentity: colors, typeLine: 'Token Creature', oracleText: '', keywords: [], power: String(p), toughness: String(t),
    legalities: {} as Card['legalities'], prices: { eur: 0, eurFoil: null, estimated: true }, image: null, imageSmall: null, artCrop: null, releasedAt: '', edhrecRank: null, isNew: false,
  }
}

/** The text the bot acts on: the whole spell for instants/sorceries, only the enters trigger for permanents. */
function effectText(c: Card) {
  const t = c.oracleText.split('\n//\n')[0]
  if (!isPermanentCard(c)) return t.toLowerCase()
  const etb = t.match(/when(ever)? [^,]*? enters(?: the battlefield)?,([^.]+\.)/i)
  return etb ? etb[2].toLowerCase() : ''
}

interface Plan {
  value: number
  apply: () => void
}

const bestTarget = (perms: Perm[], filter: (p: Perm) => boolean) => perms.filter(filter).sort((a, b) => creatureValue(b) - creatureValue(a))[0]

/** How good casting this card is right now, and what it does. null = the bot won't cast it. */
function plan(g: GameState, c: Card): Plan | null {
  const t = effectText(c)
  const mine = g.bot
  const theirs = g.me
  const theirCreatures = theirs.battlefield.filter((p) => isCreature(p.card))
  const steps: (() => void)[] = []
  let value = isPermanentCard(c) ? (isCreature(c) ? 3 + c.cmc * 1.2 : 1.5 + c.cmc * 0.5) : 0
  if (/counter target|copy target|target spell/.test(t)) return null

  if (/destroy all creatures|destroy all nonland permanents|all creatures get -\d+\/-\d+|damage to each creature/.test(t)) {
    const delta = theirCreatures.reduce((a, p) => a + creatureValue(p), 0) - mine.battlefield.filter((p) => isCreature(p.card)).reduce((a, p) => a + creatureValue(p), 0)
    if (delta < 6) return null
    value += delta
    steps.push(() => {
      for (const side of [g.me, g.bot]) {
        const dying = side.battlefield.filter((p) => isCreature(p.card) && !kw(p.card, 'Indestructible'))
        side.battlefield = side.battlefield.filter((p) => !dying.includes(p))
        side.graveyard.push(...dying.filter((p) => !p.token).map((p) => p.card))
      }
      say(g, 'bot', 'wipes the board.')
    })
  }
  const removal = t.match(/(destroy|exile) (?:up to one )?target (creature|nonland permanent|permanent|artifact or creature|creature or planeswalker|creature an opponent controls|creature you don't control)/)
  if (removal) {
    const target = bestTarget(theirs.battlefield, (p) => (removal[2].includes('creature') ? isCreature(p.card) : !isLand(p.card)) && !kw(p.card, 'Hexproof') && !(removal[1] === 'destroy' && kw(p.card, 'Indestructible')))
    if (!target && !isPermanentCard(c)) return null
    if (target) {
      value += creatureValue(target) + 2
      steps.push(() => {
        theirs.battlefield = theirs.battlefield.filter((p) => p !== target)
        if (!target.token) (removal[1] === 'exile' ? theirs.exile : theirs.graveyard).push(target.card)
        say(g, 'bot', `${removal[1] === 'exile' ? 'exiles' : 'destroys'} your ${displayName(target.card)}.`)
      })
    }
  }
  const burn = t.match(/deals? (\d+|x) damage to (any target|target creature or planeswalker|target creature|target player or planeswalker|target player|target opponent|each opponent)/)
  if (burn) {
    const dmg = n(burn[1])
    const canHitCreature = /any target|creature/.test(burn[2])
    const canHitFace = /any target|player|opponent/.test(burn[2])
    const target = canHitCreature ? bestTarget(theirCreatures, (p) => toughness(p) - p.damage <= dmg && !kw(p.card, 'Hexproof') && !kw(p.card, 'Indestructible')) : undefined
    const lethalFace = canHitFace && dmg >= theirs.life
    if (dmg === 0 || (!target && !canHitFace && !isPermanentCard(c))) return null
    if (target && !lethalFace) {
      value += creatureValue(target) + 1
      steps.push(() => {
        target.damage += dmg
        say(g, 'bot', `deals ${dmg} damage to your ${displayName(target.card)}.`)
      })
    } else if (canHitFace) {
      value += lethalFace ? 100 : dmg * 0.9
      steps.push(() => {
        theirs.life -= dmg
        say(g, 'bot', `deals ${dmg} damage to you.`)
      })
    }
  }
  const bounce = t.match(/return (?:up to one )?target (creature|nonland permanent)(?: an opponent controls| you don't control)? to its owner's hand/)
  if (bounce) {
    const target = bestTarget(theirs.battlefield, (p) => !isLand(p.card) && !kw(p.card, 'Hexproof') && (bounce[1] !== 'creature' || isCreature(p.card)))
    if (!target && !isPermanentCard(c)) return null
    if (target) {
      value += creatureValue(target) * 0.6
      steps.push(() => {
        theirs.battlefield = theirs.battlefield.filter((p) => p !== target)
        if (!target.token) theirs.hand.push({ uid: target.uid, card: target.card })
        say(g, 'bot', `returns your ${displayName(target.card)} to your hand.`)
      })
    }
  }
  const drawN = t.match(/draws? (a|two|three|four|\d+) cards?/)
  if (drawN) {
    value += n(drawN[1]) * 2
    steps.push(() => {
      draw(g, 'bot', n(drawN[1]))
      say(g, 'bot', `draws ${n(drawN[1])} card${n(drawN[1]) > 1 ? 's' : ''}.`)
    })
  }
  const gain = t.match(/you gain (\d+) life/)
  if (gain) {
    value += Number(gain[1]) * 0.4
    steps.push(() => {
      mine.life += Number(gain[1])
      say(g, 'bot', `gains ${gain[1]} life.`)
    })
  }
  const tokens = t.match(/create (a|an|one|two|three|four|\d+) (\d+)\/(\d+)/)
  if (tokens) {
    const count = n(tokens[1])
    value += count * (Number(tokens[2]) + Number(tokens[3]))
    steps.push(() => {
      for (let i = 0; i < count; i++) mine.battlefield.push({ uid: uid(), card: token(Number(tokens[2]), Number(tokens[3]), c.colors), tapped: false, damage: 0, sick: true, token: true })
      say(g, 'bot', `creates ${count} ${tokens[2]}/${tokens[3]} token${count > 1 ? 's' : ''}.`)
    })
  }
  const mill = t.match(/(?:target player|target opponent|each opponent) mills? (a|two|three|four|five|\d+) cards?/)
  if (mill) {
    value += n(mill[1]) * 0.5
    steps.push(() => {
      const milled = theirs.library.splice(0, n(mill[1]))
      theirs.graveyard.push(...milled)
      say(g, 'bot', `mills ${milled.length} of your cards.`)
    })
  }
  // An instant or sorcery with nothing the bot understands stays in hand
  if (!isPermanentCard(c) && !steps.length) return null
  if (parseCost(c).x) return null
  return {
    value,
    apply: () => {
      steps.forEach((s) => s())
      checkState(g)
    },
  }
}

function chooseLand(g: GameState) {
  const lands = g.bot.hand.filter((h) => isLand(h.card))
  if (!lands.length) return undefined
  // Prefer a land that adds a colour the hand needs and we don't have yet
  const have = new Set(g.bot.battlefield.flatMap((p) => (isLand(p.card) ? landColorsFor(p.card) : [])))
  const need = new Set(g.bot.hand.flatMap((h) => parseCost(h.card).pips))
  return lands.sort((a, b) => {
    const score = (c: Card) => landColorsFor(c).filter((x) => need.has(x) && !have.has(x)).length * 3 + landColorsFor(c).length - (/enters (the battlefield )?tapped/i.test(c.oracleText) ? 1 : 0)
    return score(b.card) - score(a.card)
  })[0]
}

function castBest(g: GameState): boolean {
  const options = g.bot.hand
    .filter((h) => !isLand(h.card) && payment(g.bot, h.card))
    .map((h) => ({ h, p: plan(g, h.card) }))
    .filter((o): o is { h: (typeof o)['h']; p: Plan } => !!o.p)
    .sort((a, b) => b.p.value - a.p.value)
  const best = options[0]
  if (!best) return false
  cast(g, 'bot', best.h.uid)
  best.p.apply()
  return true
}

function chooseAttackers(g: GameState): number[] {
  const mine = g.bot.battlefield.filter(canAttack)
  const blockers = g.me.battlefield.filter((p) => isCreature(p.card) && !p.tapped)
  const total = mine.reduce((a, p) => a + power(p), 0)
  // All in when it's lethal even if they block the biggest attackers
  const blockedPower = [...mine].sort((a, b) => power(b) - power(a)).slice(0, blockers.length).reduce((a, p) => a + power(p), 0)
  if (total - blockedPower >= g.me.life) return mine.map((p) => p.uid)
  // Keep enough back if their board threatens lethal on the swing back
  const theirPower = g.me.battlefield.filter((p) => isCreature(p.card)).reduce((a, p) => a + power(p), 0)
  const attackers: number[] = []
  for (const a of [...mine].sort((x, y) => power(y) - power(x))) {
    if (power(a) <= 0) continue
    const threats = blockers.filter((b) => canBlock(b, a) && (power(b) >= toughness(a) || kw(b.card, 'Deathtouch')) && !kw(a.card, 'Indestructible'))
    const favourable = blockers.filter((b) => canBlock(b, a)).every((b) => power(a) >= toughness(b) && creatureValue(b) >= creatureValue(a) * 0.8)
    const safe = threats.length === 0 || kw(a.card, 'Menace')
    if (safe || favourable) attackers.push(a.uid)
  }
  const stayingBack = mine.filter((p) => !attackers.includes(p.uid) || kw(p.card, 'Vigilance'))
  if (theirPower >= g.bot.life && stayingBack.length === 0 && attackers.length) attackers.pop()
  return attackers
}

/** The bot blocks your attack: good blocks first, chump only to survive. */
export function botBlocks(g: GameState) {
  const attackers = g.attackers.map((u) => g.me.battlefield.find((p) => p.uid === u)!).filter(Boolean).sort((a, b) => power(b) - power(a))
  const free = new Set(g.bot.battlefield.filter((p) => isCreature(p.card) && !p.tapped).map((p) => p.uid))
  let incoming = attackers.reduce((s, a) => s + power(a), 0)
  for (const a of attackers) {
    if (kw(a.card, 'Menace')) continue // needs two blockers — this engine assigns one
    const options = g.bot.battlefield.filter((b) => free.has(b.uid) && canBlock(b, a))
    const kills = (b: Perm) => power(b) >= toughness(a) - a.damage || (kw(b.card, 'Deathtouch') && power(b) > 0)
    const survives = (b: Perm) => (power(a) < toughness(b) && !kw(a.card, 'Deathtouch')) || kw(b.card, 'Indestructible')
    let pick = options.find((b) => kills(b) && survives(b)) ?? options.find((b) => survives(b))
    if (!pick) {
      const trade = options.filter(kills).sort((x, y) => creatureValue(x) - creatureValue(y))[0]
      if (trade && creatureValue(trade) <= creatureValue(a)) pick = trade
    }
    if (!pick && incoming >= g.bot.life) pick = options.sort((x, y) => creatureValue(x) - creatureValue(y))[0] // chump to survive
    if (pick) {
      g.blocks[a.uid] = pick.uid
      free.delete(pick.uid)
      incoming -= power(a)
    }
  }
}

/** The bot's whole turn, one visible step at a time. */
export function* botTurn(g: GameState): Generator<BotStep, void, void> {
  // phase changes inside engine calls, so always re-read it
  const over = () => g.phase === 'over'
  if (over()) return
  yield { kind: 'action' } // untap + draw already happened in startTurn
  const land = chooseLand(g)
  if (land) {
    playLand(g, 'bot', land.uid)
    yield { kind: 'action' }
  }
  while (!over() && castBest(g)) yield { kind: 'action' }
  if (over()) return
  const attackers = chooseAttackers(g)
  if (attackers.length) {
    declareAttack(g, attackers)
    yield { kind: 'await-blocks' } // the UI lets you block, then resolves combat
    if (over()) return
  }
  while (!over() && castBest(g)) yield { kind: 'action' }
  if (over()) return
  say(g, 'bot', 'ends its turn.')
  endTurn(g)
}
