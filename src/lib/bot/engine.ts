import type { Card, Color, Deck } from '../types'
import { displayName, isCreature, isLand } from '../cardDb'
import { landColors } from '../builder'
import { shuffle } from '../random'

// A small rules engine for practice games against a bot. It models what a
// simple opponent needs — lands and mana, casting, summoning sickness, combat
// with the common keywords, life and decking — and deliberately ignores most
// card text. The bot understands a handful of effects it can read from oracle
// text; your own card effects you apply by hand.

export type Side = 'me' | 'bot'
const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G']

export interface Perm {
  uid: number
  card: Card
  tapped: boolean
  damage: number
  sick: boolean // entered this turn (summoning sickness)
  token?: boolean
}

export interface PlayerState {
  library: Card[]
  hand: { uid: number; card: Card }[]
  battlefield: Perm[]
  graveyard: Card[]
  exile: Card[]
  life: number
  landPlayed: boolean
  mulligans: number
}

export interface CombatPair {
  attacker: number
  blocker: number | null
}

export interface GameState {
  me: PlayerState
  bot: PlayerState
  active: Side
  turn: number
  phase: 'mulligan' | 'main' | 'attack' | 'block' | 'over'
  attackers: number[] // declared attackers of the active player
  blocks: Record<number, number> // attacker uid → blocker uid
  winner?: Side
  log: { side: Side | 'game'; text: string }[]
  firstPlayer: Side
}

let nextUid = 1
export const uid = () => nextUid++

// ---- card facts --------------------------------------------------------------------------
export const kw = (c: Card, k: string) => c.keywords.includes(k)
const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : v?.includes('*') ? 1 : Number(v ?? 0) || 0)
export const power = (p: Perm) => num(p.card.power)
export const toughness = (p: Perm) => num(p.card.toughness)
export const isPermanentCard = (c: Card) => !/\b(Instant|Sorcery)\b/.test(c.typeLine.split(' // ')[0])
export const landColorsFor = (c: Card) => landColors(c)
export const creatureValue = (p: Perm) => power(p) * 1.5 + toughness(p) + p.card.cmc * 0.5 + (kw(p.card, 'Flying') ? 2 : 0) + (kw(p.card, 'Deathtouch') ? 2 : 0) + (kw(p.card, 'Lifelink') ? 1 : 0)
export const canAttack = (p: Perm) => isCreature(p.card) && !p.tapped && (!p.sick || kw(p.card, 'Haste')) && !kw(p.card, 'Defender')
export function canBlock(blocker: Perm, attacker: Perm) {
  if (!isCreature(blocker.card) || blocker.tapped) return false
  if (kw(attacker.card, 'Flying') && !kw(blocker.card, 'Flying') && !kw(blocker.card, 'Reach')) return false
  return true
}

// ---- mana ----------------------------------------------------------------------------------
interface Cost {
  generic: number
  pips: Color[]
  x: boolean
}
export function parseCost(c: Card): Cost {
  const cost: Cost = { generic: 0, pips: [], x: false }
  for (const sym of c.manaCost.split(' // ')[0].match(/\{[^}]+\}/g) ?? []) {
    const s = sym.slice(1, -1)
    if (/^\d+$/.test(s)) cost.generic += Number(s)
    else if (s === 'X') cost.x = true
    else if (COLORS.includes(s as Color)) cost.pips.push(s as Color)
    else cost.generic += 1 // hybrid, phyrexian, colourless, snow: pay with anything
  }
  return cost
}
/** What a permanent can tap for (lands, mana creatures, mana rocks). */
export function manaOf(p: Perm): Color[] | null {
  if (isLand(p.card)) {
    const c = landColors(p.card)
    return c.length ? c : ['C' as Color]
  }
  const m = p.card.oracleText.match(/\{T\}(?:, [^:]+)?: Add ([^.]+)/)
  if (!m) return null
  if (/any color/i.test(m[1])) return COLORS
  const cs = [...m[1].matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1] as Color)
  return cs.length ? [...new Set(cs)] : null
}
function sources(p: PlayerState) {
  return p.battlefield.filter((x) => !x.tapped && manaOf(x) && (isLand(x.card) || !isCreature(x.card) || !x.sick))
}
export const manaAvailable = (p: PlayerState) => sources(p).length

/** Picks sources that pay the cost (coloured pips first, least flexible source first). */
export function payment(p: PlayerState, card: Card): number[] | null {
  const cost = parseCost(card)
  const pool = sources(p).map((x) => ({ uid: x.uid, colors: manaOf(x)! }))
  const used = new Set<number>()
  for (const pip of cost.pips) {
    const src = pool.filter((s) => !used.has(s.uid) && s.colors.includes(pip)).sort((a, b) => a.colors.length - b.colors.length)[0]
    if (!src) return null
    used.add(src.uid)
  }
  const rest = pool.filter((s) => !used.has(s.uid)).sort((a, b) => a.colors.length - b.colors.length)
  if (rest.length < cost.generic) return null
  rest.slice(0, cost.generic).forEach((s) => used.add(s.uid))
  return [...used]
}

// ---- setup ------------------------------------------------------------------------------------
function makePlayer(deck: Deck, life: number): PlayerState {
  const library: Card[] = []
  for (const dc of deck.cards) for (let i = 0; i < dc.qty; i++) library.push(dc.card)
  const lib = shuffle(library)
  return { library: lib.slice(7), hand: lib.slice(0, 7).map((card) => ({ uid: uid(), card })), battlefield: [], graveyard: [], exile: [], life, landPlayed: false, mulligans: 0 }
}

export function newGame(my: Deck, bot: Deck, first: Side): GameState {
  const life = my.commander || bot.commander ? 40 : 20
  const g: GameState = { me: makePlayer(my, life), bot: makePlayer(bot, life), active: first, turn: 1, phase: 'mulligan', attackers: [], blocks: {}, log: [], firstPlayer: first }
  botMulligan(g, bot)
  say(g, 'game', `${first === 'me' ? 'You go' : 'The bot goes'} first.`)
  return g
}

function botMulligan(g: GameState, deck: Deck) {
  const lands = g.bot.hand.filter((h) => isLand(h.card)).length
  if (lands >= 2 && lands <= 5) return
  // Mulligan once to six: redraw 7, bottom the most expensive card
  const again = makePlayer(deck, g.bot.life)
  again.hand.sort((a, b) => b.card.cmc - a.card.cmc)
  const bottom = again.hand.shift()!
  again.library.push(bottom.card)
  g.bot = { ...again, mulligans: 1 }
  say(g, 'bot', 'mulligans to six.')
}

export function myMulligan(g: GameState, deck: Deck) {
  const n = g.me.mulligans + 1
  g.me = { ...makePlayer(deck, g.me.life), mulligans: n }
}
export function myKeep(g: GameState, bottom: number[]) {
  const put = g.me.hand.filter((h) => bottom.includes(h.uid))
  g.me.hand = g.me.hand.filter((h) => !bottom.includes(h.uid))
  g.me.library.push(...put.map((h) => h.card))
  g.phase = 'main'
  startTurn(g, g.active, g.turn === 1)
}

// ---- helpers ----------------------------------------------------------------------------------
export function say(g: GameState, side: Side | 'game', text: string) {
  g.log.push({ side, text })
  if (g.log.length > 200) g.log.shift()
}
const P = (g: GameState, s: Side) => (s === 'me' ? g.me : g.bot)
const other = (s: Side): Side => (s === 'me' ? 'bot' : 'me')

export function draw(g: GameState, side: Side, n = 1) {
  const p = P(g, side)
  for (let i = 0; i < n; i++) {
    const c = p.library.shift()
    if (!c) {
      lose(g, side, 'tried to draw from an empty library')
      return
    }
    p.hand.push({ uid: uid(), card: c })
  }
}

function lose(g: GameState, side: Side, why: string) {
  if (g.phase === 'over') return
  g.phase = 'over'
  g.winner = other(side)
  say(g, 'game', `${side === 'me' ? 'You' : 'The bot'} ${why}. ${side === 'me' ? 'The bot wins.' : 'You win!'}`)
}

export function checkState(g: GameState) {
  for (const side of ['me', 'bot'] as Side[]) {
    const p = P(g, side)
    // Lethal damage and 0-toughness creatures die (indestructible survives damage)
    const dead = p.battlefield.filter((x) => isCreature(x.card) && (toughness(x) <= 0 || (x.damage >= toughness(x) && !kw(x.card, 'Indestructible'))))
    for (const d of dead) {
      p.battlefield = p.battlefield.filter((x) => x.uid !== d.uid)
      if (!d.token) p.graveyard.push(d.card)
      say(g, side, `${displayName(d.card)} dies.`)
    }
  }
  if (g.me.life <= 0) lose(g, 'me', 'dropped to 0 life')
  else if (g.bot.life <= 0) lose(g, 'bot', 'dropped to 0 life')
}

export function startTurn(g: GameState, side: Side, skipDraw = false) {
  const p = P(g, side)
  g.active = side
  g.phase = 'main'
  g.attackers = []
  g.blocks = {}
  p.landPlayed = false
  for (const x of p.battlefield) {
    x.tapped = false
    x.sick = false
  }
  for (const x of [...g.me.battlefield, ...g.bot.battlefield]) x.damage = 0
  if (!skipDraw) draw(g, side)
}

// ---- playing cards ----------------------------------------------------------------------------
export function playLand(g: GameState, side: Side, handUid: number): string | null {
  const p = P(g, side)
  const h = p.hand.find((x) => x.uid === handUid)
  if (!h || !isLand(h.card)) return 'That is not a land.'
  if (p.landPlayed) return 'You already played a land this turn.'
  p.hand = p.hand.filter((x) => x.uid !== handUid)
  const tapped = /enters (the battlefield )?tapped/i.test(h.card.oracleText) && !/unless|you may pay/i.test(h.card.oracleText)
  p.battlefield.push({ uid: h.uid, card: h.card, tapped, damage: 0, sick: false })
  p.landPlayed = true
  say(g, side, `plays ${displayName(h.card)}.`)
  return null
}

/** Casts a spell, paying automatically. Returns an error message or null. */
export function cast(g: GameState, side: Side, handUid: number, free = false): string | null {
  const p = P(g, side)
  const h = p.hand.find((x) => x.uid === handUid)
  if (!h) return 'Card not in hand.'
  if (isLand(h.card)) return playLand(g, side, handUid)
  if (!free) {
    const pay = payment(p, h.card)
    if (!pay) return 'Not enough mana of the right colours.'
    for (const u of pay) p.battlefield.find((x) => x.uid === u)!.tapped = true
  }
  p.hand = p.hand.filter((x) => x.uid !== handUid)
  if (isPermanentCard(h.card)) {
    p.battlefield.push({ uid: h.uid, card: h.card, tapped: false, damage: 0, sick: true })
    say(g, side, `casts ${displayName(h.card)}.`)
  } else {
    p.graveyard.push(h.card)
    say(g, side, `casts ${displayName(h.card)}.`)
  }
  return null
}

// ---- manual effects (the human applies their own card text) ------------------------------------
export type Manual = 'destroy' | 'exile' | 'bounce' | 'sacrifice' | 'tap' | 'untap' | 'damage'
export function manual(g: GameState, owner: Side, permUid: number, what: Manual, amount = 0) {
  const p = P(g, owner)
  const x = p.battlefield.find((b) => b.uid === permUid)
  if (!x) return
  const name = displayName(x.card)
  const remove = () => (p.battlefield = p.battlefield.filter((b) => b.uid !== permUid))
  switch (what) {
    case 'destroy':
    case 'sacrifice':
      if (what === 'destroy' && kw(x.card, 'Indestructible')) return say(g, 'me', `tries to destroy ${name}, but it's indestructible.`)
      remove()
      if (!x.token) p.graveyard.push(x.card)
      return say(g, 'me', `${what === 'destroy' ? 'destroys' : 'sacrifices'} ${name}.`)
    case 'exile':
      remove()
      if (!x.token) p.exile.push(x.card)
      return say(g, 'me', `exiles ${name}.`)
    case 'bounce':
      remove()
      if (!x.token) p.hand.push({ uid: uid(), card: x.card })
      return say(g, 'me', `returns ${name} to its owner's hand.`)
    case 'tap':
    case 'untap':
      x.tapped = what === 'tap'
      return say(g, 'me', `${what}s ${name}.`)
    case 'damage':
      x.damage += amount
      say(g, 'me', `deals ${amount} damage to ${name}.`)
      return checkState(g)
  }
}

// ---- combat -------------------------------------------------------------------------------------
export function declareAttack(g: GameState, attackers: number[]) {
  const p = P(g, g.active)
  g.attackers = attackers.filter((u) => {
    const x = p.battlefield.find((b) => b.uid === u)
    return x && canAttack(x)
  })
  for (const u of g.attackers) {
    const x = p.battlefield.find((b) => b.uid === u)!
    if (!kw(x.card, 'Vigilance')) x.tapped = true
  }
  g.blocks = {}
  g.phase = g.attackers.length ? 'block' : 'main'
  if (g.attackers.length) say(g, g.active, `attacks with ${g.attackers.map((u) => displayName(p.battlefield.find((b) => b.uid === u)!.card)).join(', ')}.`)
}

/** Resolves combat with first strike, deathtouch, trample and lifelink. One blocker per attacker. */
export function resolveCombat(g: GameState) {
  const atk = P(g, g.active)
  const def = P(g, other(g.active))
  const pairs = g.attackers.map((a) => ({ a: atk.battlefield.find((x) => x.uid === a)!, b: g.blocks[a] ? def.battlefield.find((x) => x.uid === g.blocks[a]) : undefined })).filter((p) => p.a)
  for (const { a, b } of pairs) if (b) say(g, other(g.active), `blocks ${displayName(a.card)} with ${displayName(b.card)}.`)
  let toPlayer = 0
  const strike = (first: boolean) => {
    for (const { a, b } of pairs) {
      const aFirst = kw(a.card, 'First strike') || kw(a.card, 'Double strike')
      const aRegular = !kw(a.card, 'First strike') || kw(a.card, 'Double strike')
      const bFirst = b && (kw(b.card, 'First strike') || kw(b.card, 'Double strike'))
      const bRegular = b && (!kw(b.card, 'First strike') || kw(b.card, 'Double strike'))
      const aAlive = atk.battlefield.includes(a) && (a.damage < toughness(a) || kw(a.card, 'Indestructible'))
      const bAlive = b && def.battlefield.includes(b) && (b.damage < toughness(b) || kw(b.card, 'Indestructible'))
      // attacker deals damage
      if (aAlive && (first ? aFirst : aRegular)) {
        const pw = power(a)
        if (!b) {
          toPlayer += pw
          if (kw(a.card, 'Lifelink')) atk.life += pw
        } else if (bAlive) {
          const lethal = kw(a.card, 'Deathtouch') ? 1 : Math.max(0, toughness(b) - b.damage)
          const onBlocker = kw(a.card, 'Trample') ? Math.min(pw, lethal) : pw
          b.damage += kw(a.card, 'Deathtouch') && onBlocker > 0 ? 999 : onBlocker
          if (kw(a.card, 'Trample')) toPlayer += pw - onBlocker
          if (kw(a.card, 'Lifelink')) atk.life += pw
        } else if (kw(a.card, 'Trample')) toPlayer += pw // blocker already dead
      }
      // blocker deals damage back
      if (b && bAlive && (first ? bFirst : bRegular) && atk.battlefield.includes(a)) {
        const pw = power(b)
        a.damage += kw(b.card, 'Deathtouch') && pw > 0 ? 999 : pw
        if (kw(b.card, 'Lifelink')) def.life += pw
      }
    }
    checkState(g)
  }
  strike(true)
  strike(false)
  if (toPlayer > 0) {
    def.life -= toPlayer
    say(g, g.active, `deals ${toPlayer} combat damage to ${g.active === 'me' ? 'the bot' : 'you'}.`)
  }
  g.attackers = []
  g.blocks = {}
  if (g.phase !== 'over') g.phase = 'main'
  checkState(g)
}

export function endTurn(g: GameState) {
  if (g.phase === 'over') return
  const p = P(g, g.active)
  // Hand size 7 (the bot discards its most expensive cards; you do it yourself)
  if (g.active === 'bot')
    while (p.hand.length > 7) {
      p.hand.sort((a, b) => b.card.cmc - a.card.cmc)
      p.graveyard.push(p.hand.shift()!.card)
    }
  const next = other(g.active)
  if (next === g.firstPlayer) g.turn++
  startTurn(g, next)
}

export { other }
