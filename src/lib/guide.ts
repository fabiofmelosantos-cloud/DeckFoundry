import type { Card, DeckAnalysis } from './types'
import { displayName, findCard, isCreature, isLand } from './cardDb'
import { tagLabel, tagsOf, type TagId } from './tags'
import { WINCON } from './builder'

// Strategy guide for any deck — curated, AI-built or imported. Everything is derived
// from the actual list: its themes, curve, interaction and land count.

export type Style = 'Aggro' | 'Midrange' | 'Control' | 'Ramp' | 'Combo'

export interface Guide {
  style: Style
  theme: TagId | null
  speed: 'Fast' | 'Medium' | 'Slow'
  summary: string
  plan: { phase: string; turns: string; text: string; cards: Card[] }[]
  mulligan: { keep: string; ship: string; odds: { label: string; pct: number }[]; openers: Card[] }
  tips: string[]
  matchups: { good: string[]; bad: string[] }
  roles: { card: Card; role: string; why: string }[]
  winCondition: string
  strengths: string[]
  weaknesses: string[]
}

const GENERIC = new Set<string>(['removal', 'draw', 'etb', 'protection', 'flying', 'haste', 'ramp', 'big', 'tribe:Human', 'tribe:Soldier'])

const STYLE_TEXT: Record<Style, string> = {
  Aggro: 'a fast deck that wants to win before the opponent can stabilise',
  Midrange: 'a flexible deck that trades efficiently early and wins the long game with stronger cards',
  Control: 'a reactive deck: answer what matters, then win late with a few resilient threats',
  Ramp: 'a deck that accelerates its mana to land huge threats ahead of schedule',
  Combo: 'a deck that assembles specific card combinations that win on the spot',
}

const THEME_TEXT: Record<string, string> = {
  sacrifice: 'turns its own creatures dying into value and damage',
  aristocrats: 'turns its own creatures dying into value and damage',
  tokens: 'floods the board with small creatures',
  counters: 'grows its creatures with +1/+1 counters',
  lifegain: 'gains life every turn and converts it into power',
  'lifegain-payoff': 'gains life every turn and converts it into power',
  graveyard: 'uses the graveyard as a second hand',
  'self-mill': 'fills its own graveyard to fuel powerful payoffs',
  reanimate: 'brings creatures back from the graveyard',
  mill: "empties the opponent's library",
  spells: 'chains cheap instants and sorceries',
  prowess: 'chains cheap spells to pump prowess creatures',
  artifacts: 'builds an artifact engine that snowballs',
  landfall: 'gets value from every land that enters',
  lands: 'plays extra lands for value',
  food: 'makes Food and cashes it in for value',
  treasure: 'makes Treasure to power out big turns',
  flying: 'attacks through the air',
  equipment: 'suits up one threat at a time',
  counterspell: 'answers everything the opponent tries',
  removal: 'trades removal for every threat',
}

const ROLE: Record<string, [string, string]> = {
  sacrifice: ['Sacrifice outlet', 'Turns any creature into value at instant speed and dodges removal'],
  aristocrats: ['Death payoff', 'Every creature that dies drains or draws'],
  tokens: ['Token maker', 'Provides bodies — blockers, attackers or sacrifice fodder'],
  counters: ['Counter engine', 'Adds or multiplies +1/+1 counters'],
  lifegain: ['Lifegain source', 'Triggers every lifegain payoff'],
  'lifegain-payoff': ['Lifegain payoff', 'Grows or drains whenever you gain life'],
  'self-mill': ['Enabler', 'Fills the graveyard for your payoffs'],
  graveyard: ['Graveyard payoff', 'Gets stronger as the graveyard fills'],
  reanimate: ['Recursion', 'Brings key cards back after removal'],
  mill: ['Mill engine', "Removes cards from the opponent's library"],
  spells: ['Spell payoff', 'Rewards casting instants and sorceries'],
  prowess: ['Prowess threat', 'Grows with each noncreature spell'],
  ramp: ['Ramp', 'Gets you ahead on mana'],
  draw: ['Card advantage', 'Keeps your hand full'],
  removal: ['Interaction', 'Removes their best threat'],
  counterspell: ['Interaction', 'Stops their key spell'],
  wipe: ['Board wipe', 'Resets the board when you fall behind'],
  tutor: ['Tutor', 'Finds the missing piece'],
  landfall: ['Landfall payoff', 'Triggers with every land drop'],
  artifacts: ['Artifact synergy', 'Part of the artifact engine'],
  big: ['Finisher', 'Big threat that ends the game'],
}

// ---- maths -----------------------------------------------------------------------
function choose(n: number, k: number) {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
/** P(lo ≤ successes ≤ hi) drawing n from N with K successes (hypergeometric). */
function hyper(N: number, K: number, n: number, lo: number, hi: number) {
  let p = 0
  for (let k = lo; k <= Math.min(hi, K, n); k++) p += (choose(K, k) * choose(N - K, n - k)) / choose(N, n)
  return p
}
const pct = (p: number) => Math.round(p * 100)
const names = (cs: Card[]) => cs.map((c) => displayName(c).split(',')[0])
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export function buildGuide(a: DeckAnalysis): Guide {
  const d = a.deck
  const cmd = !!d.commander
  const N = a.total
  const nonland = d.cards.filter((c) => !isLand(c.card) && !c.commander)
  const nonlandQty = nonland.reduce((s, c) => s + c.qty, 0) || 1
  const lands = a.types.Land ?? 0
  const count = (t: TagId) => nonland.filter((c) => tagsOf(c.card).includes(t)).reduce((s, c) => s + c.qty, 0)
  const avg = a.curve.reduce((s, n, i) => s + n * i, 0) / Math.max(1, a.curve.reduce((s, n) => s + n, 0))
  const creatures = nonland.filter((c) => isCreature(c.card)).reduce((s, c) => s + c.qty, 0)
  const interaction = count('removal') + count('counterspell') + count('wipe')
  const ramp = count('ramp')
  const draw = count('draw')

  // Dominant theme, weighted by copies (commander counts triple)
  const weights = new Map<TagId, number>()
  const all = [...nonland, ...(d.commander ? [{ card: d.commander, qty: 3 }] : [])]
  const tribePayoffs = (tribe: string) => all.filter((c) => new RegExp(`\\b${tribe}s?\\b`).test(c.card.oracleText)).reduce((n, c) => n + c.qty, 0)
  for (const c of all)
    for (const t of tagsOf(c.card)) {
      if (GENERIC.has(t) || (t.startsWith('tribe:') && tribePayoffs(t.slice(6)) < 3)) continue
      weights.set(t, (weights.get(t) ?? 0) + c.qty)
    }
  const theme = ([...weights.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] as TagId | undefined) ?? null
  const theme2 = [...weights.entries()].sort((x, y) => y[1] - x[1])[1]?.[0] as TagId | undefined

  let style: Style = 'Midrange'
  if (a.combos.length && a.combos.some((cb) => !/engine|efficient|drains|free|army/i.test(cb.result))) style = 'Combo'
  else if (
    avg <= 2.4 &&
    creatures / nonlandQty >= 0.45 &&
    interaction / nonlandQty < 0.3 &&
    (count('haste') + count('prowess') >= 6 || (theme != null && (theme.startsWith('tribe:') || ['flying', 'prowess', 'haste', 'equipment'].includes(theme))))
  )
    style = 'Aggro'
  else if (count('counterspell') >= (cmd ? 6 : 4) || (interaction / nonlandQty >= 0.3 && creatures / nonlandQty <= 0.3)) style = 'Control'
  else if (ramp / nonlandQty >= (cmd ? 0.14 : 0.18) && avg >= 3) style = 'Ramp'
  const speed: Guide['speed'] = style === 'Aggro' || (avg <= 2 && style !== 'Control') ? 'Fast' : avg >= 3.4 || style === 'Ramp' || style === 'Control' ? 'Slow' : 'Medium'

  const byCmc = [...nonland].sort((x, y) => x.card.cmc - y.card.cmc)
  const themeCards = (cs: typeof nonland) => cs.filter((c) => theme && tagsOf(c.card).includes(theme))
  const earlyCut = cmd ? 3 : 2
  const early = byCmc.filter((c) => c.card.cmc <= earlyCut && c.card.cmc > 0)
  const openers = [...themeCards(early), ...early.filter((c) => tagsOf(c.card).includes('ramp')), ...early].map((c) => c.card)
  const uniq = (cs: Card[]) => [...new Map(cs.map((c) => [c.name, c])).values()]
  const earlyCards = uniq(openers).slice(0, 4)
  const keyCards = d.keyCards.map((n) => d.cards.find((c) => c.card.name === n)?.card ?? findCard(n)).filter(Boolean) as Card[]
  const midCards = uniq([...keyCards.filter((c) => c.cmc >= 3 && c.cmc <= 5), ...themeCards(byCmc.filter((c) => c.card.cmc >= 3 && c.card.cmc <= 5)).map((c) => c.card)]).slice(0, 4)
  const desc = [...byCmc].reverse()
  const topEnd = uniq([...themeCards(desc.filter((c) => c.card.cmc >= 3)), ...desc.filter((c) => isCreature(c.card) || tagsOf(c.card).includes('big'))].map((c) => c.card)).slice(0, 3)
  const combo = a.combos[0]

  const doublers = uniq(nonland.filter((c) => /twice that many|that many plus one|additional \+1\/\+1 counter/i.test(c.card.oracleText)).map((c) => c.card))
  const DOUBLER_HINT = doublers.length ? ` Land ${names(doublers)[0]} before your counter creatures.` : ' Spread counters so one removal spell doesn’t undo them.'

  // ---- plan -------------------------------------------------------------------------------
  const earlyText: Record<Style, string> = {
    Aggro: 'Curve out — play a threat every turn and attack.',
    Midrange: 'Develop efficiently and spend cheap removal on their best early play.',
    Control: 'Make every land drop and keep cheap interaction ready.',
    Ramp: 'Ramp first; a mana creature on turn one or two is worth more than a small threat.',
    Combo: 'Set up: dig for the combo pieces and hold interaction to protect them.',
  }
  const themeEarly: Partial<Record<string, string>> = {
    'self-mill': ' Start filling your graveyard.',
    graveyard: ' Start filling your graveyard.',
    tokens: ' Get a token maker down early.',
    counters: DOUBLER_HINT,
    lifegain: ' Land a lifegain source early so every later payoff gets triggers.',
    'lifegain-payoff': ' Get a payoff down before your lifegain sources.',
    sacrifice: ' Land a sacrifice outlet so removal never gets clean value.',
  }
  const plan: Guide['plan'] = [
    { phase: 'Early game', turns: cmd ? 'Turns 1–4' : 'Turns 1–3', text: earlyText[style] + (theme ? themeEarly[theme] ?? '' : ''), cards: earlyCards },
    {
      phase: 'Mid game',
      turns: cmd ? 'Turns 5–7' : 'Turns 3–5',
      text: midCards.length
        ? `Deploy the engine — ${list(names(midCards))}. ${theme ? `This is where the deck ${THEME_TEXT[theme] ?? 'comes together'}.` : ''}`
        : 'Add pressure while keeping answers for their key threats.',
      cards: midCards,
    },
    {
      phase: 'Late game',
      turns: cmd ? 'Turn 8+' : 'Turn 6+',
      text: combo
        ? `Assemble ${list(combo.cards)}: ${combo.result.toLowerCase()} Wait until the opponent is tapped low.`
        : topEnd.length
          ? `Close the game with ${list(names(topEnd))}. ${style === 'Control' ? 'Only commit threats once their answers run out.' : ''}`
          : 'Keep the pressure on and use every card to push damage.',
      cards: combo ? (combo.cards.map((n) => findCard(n)).filter(Boolean) as Card[]) : topEnd,
    },
  ]

  // ---- mulligan -----------------------------------------------------------------------------
  const [lo, hi] = cmd ? [3, 5] : style === 'Aggro' && lands <= 21 ? [1, 3] : [2, 4]
  const landOdds = hyper(N - (cmd ? 1 : 0), lands, 7, lo, hi)
  const odds: Guide['mulligan']['odds'] = [{ label: `Opening hand with ${lo}–${hi} lands`, pct: pct(landOdds) }]
  const earlyPlays = early.reduce((s, c) => s + c.qty, 0)
  if (earlyPlays) odds.push({ label: `At least one ${cmd ? '≤3' : '1–2'}-mana play in your opener`, pct: pct(1 - hyper(N, earlyPlays, 7, 0, 0)) })
  for (const k of keyCards.filter((c) => !isLand(c) && c.id !== d.commander?.id).slice(0, 2)) {
    const q = d.cards.find((c) => c.card.id === k.id)?.qty ?? 1
    const seen = 7 + Math.max(0, Math.round(k.cmc) - 1) // cards seen by the turn you can cast it, on the play
    odds.push({ label: `See ${displayName(k).split(',')[0]} by turn ${Math.max(1, Math.round(k.cmc))} (on the play)`, pct: pct(1 - hyper(N, q, seen, 0, 0)) })
  }
  const keep = `Keep ${lo}–${hi} lands with at least one early play${earlyCards.length ? ` (ideally ${list(names(earlyCards.slice(0, 3)))})` : ''}.${cmd ? ' Your commander is always available, so lands and ramp matter most.' : ''}`
  const ship =
    style === 'Aggro'
      ? 'Mulligan hands with no one- or two-drops, or with 4+ lands.'
      : style === 'Combo'
        ? 'Mulligan hands with no piece of the combo and no way to dig for it.'
        : `Mulligan ${lo - 1 <= 0 ? 'zero' : `${lo - 1} or fewer`}-land and ${hi + 1}+-land hands, and hands where everything costs 4 or more.`

  // ---- tips ------------------------------------------------------------------------------------
  const tips: string[] = []
  const has = (t: TagId, n = 3) => count(t) >= n
  if (has('sacrifice', 2) && (has('aristocrats', 2) || has('tokens', 3))) tips.push('Keep a sacrifice outlet on the table: when removal targets a creature, sacrifice it in response for value.')
  if (has('tokens', 6)) tips.push("Don't overextend — against open mana or a likely board wipe, hold back one or two token makers.")
  if (doublers.length) tips.push(`Play ${list(names(doublers))} before the creatures and spells that place counters.`)
  if (has('lifegain-payoff', 2)) tips.push('Deploy lifegain payoffs before lifegain sources so every trigger counts.')
  if (has('self-mill', 3) && has('graveyard', 2)) tips.push('Mill early, cast graveyard payoffs later — delve, escape and undergrowth get stronger every turn.')
  if (has('prowess', 3) || (has('spells', 4) && style !== 'Control')) tips.push('Cast cantrips and cheap spells before combat to pump prowess and spell payoffs.')
  if (has('counterspell', 3)) tips.push('Pass with mana open and cast your own threats at the end of their turn when you can.')
  if (ramp >= (cmd ? 8 : 6)) tips.push(`On turn ${cmd ? 'two or three' : 'two'}, ramp beats a small creature — it gets your big spells out a turn earlier.`)
  if (has('haste', 3)) tips.push('Hold hasty creatures until the opponent taps out of removal.')
  if (has('wipe', 1)) tips.push('Before casting your own board wipe, hold back creatures so you recover faster.')
  if (has('landfall', 3)) tips.push('Save land drops (and fetchlands) for turns when a landfall creature is out.')
  if (combo) tips.push(`Protect the combo: don't expose ${list(combo.cards)} into open removal if you can wait a turn.`)
  if (interaction < (cmd ? 6 : 5)) tips.push('You have little interaction — race rather than trade, and save removal for the one threat that beats you.')
  if (tips.length < 3) tips.push('Count your outs every turn: pressure when ahead, hold removal for real threats when behind.')

  // ---- matchups -----------------------------------------------------------------------------
  const good: string[] = []
  const bad: string[] = []
  const M: Record<Style, [string[], string[]]> = {
    Aggro: [['Slow control and ramp decks', 'Decks with clunky, expensive starts'], ['Lifegain and cheap blockers', 'Early board wipes']],
    Midrange: [['Aggro decks that run out of cards', 'Decks relying on a single threat'], ['Fast combo', 'Bigger ramp decks in the late game']],
    Control: [['Midrange value decks', 'Combo decks (you can counter the key piece)'], ['Wide, fast aggro', 'Hexproof and uncounterable threats']],
    Ramp: [['Midrange and control', 'Decks that can’t pressure early'], ['Fast aggro', 'Counterspells on your big payoff']],
    Combo: [['Slow, creature-based decks', 'Decks with little interaction'], ['Counterspells and discard', 'Fast aggro']],
  }
  good.push(...M[style][0])
  bad.push(...M[style][1])
  const themeBad: Partial<Record<string, string>> = {
    graveyard: 'Graveyard hate (Rest in Peace, Bojuka Bog)',
    'self-mill': 'Graveyard hate (Rest in Peace, Bojuka Bog)',
    reanimate: 'Graveyard hate (Rest in Peace, Bojuka Bog)',
    tokens: 'Cheap sweepers that kill small creatures',
    counters: 'Bounce and exile effects that reset counters',
    artifacts: 'Mass artifact removal (Vandalblast)',
    lifegain: 'Effects that stop lifegain',
    equipment: 'Edicts and sacrifice effects',
  }
  if (theme && themeBad[theme]) bad.push(themeBad[theme]!)
  if (interaction >= (cmd ? 10 : 8)) good.push('Opposing engines and combos — you have the removal')
  else bad.push('Opposing combos — little interaction to stop them')

  // ---- roles ---------------------------------------------------------------------------------------
  const roles = uniq([...(d.commander ? [d.commander] : []), ...keyCards, ...midCards]).slice(0, 6).map((c) => {
    const t = tagsOf(c).find((x) => ROLE[x] && (x === theme || x === theme2)) ?? tagsOf(c).find((x) => ROLE[x] && !GENERIC.has(x)) ?? tagsOf(c).find((x) => ROLE[x])
    const [role, why] = c.id === d.commander?.id ? ['Commander', 'Always available — the deck is built around it'] : t ? ROLE[t] : ['Support', 'Rounds out the plan']
    return { card: c, role, why }
  })

  // ---- fallbacks for decks without authored text (imported lists) ------------------------------------
  const strengths: string[] = []
  const weaknesses: string[] = []
  if (interaction >= (cmd ? 8 : 7)) strengths.push(`Plenty of interaction (${interaction} answers)`)
  else weaknesses.push(`Light on interaction (${interaction} answers)`)
  if (draw >= (cmd ? 8 : 5)) strengths.push(`Good card flow (${draw} draw sources)`)
  else weaknesses.push('Can run out of cards in long games')
  if (avg <= 2.6) strengths.push(`Low curve (${avg.toFixed(1)} average) — consistent starts`)
  if (avg >= 3.6) weaknesses.push(`Top-heavy curve (${avg.toFixed(1)} average)`)
  if (a.combos.length) strengths.push(`${a.combos.length} built-in combo${a.combos.length > 1 ? 's' : ''}`)

  const themeLabel = theme ? tagLabel(theme).toLowerCase() : null
  const summary = `${d.name} is ${STYLE_TEXT[style]}${theme ? `. At its core it ${THEME_TEXT[theme] ?? `plays around ${themeLabel}`}` : ''}${theme2 && theme2 !== theme ? `, backed by ${tagLabel(theme2).toLowerCase()}` : ''}. Speed: ${speed.toLowerCase()} (average mana value ${avg.toFixed(1)}, ${lands} lands).`

  return {
    style,
    theme,
    speed,
    summary,
    plan,
    mulligan: { keep, ship, odds, openers: earlyCards },
    tips: tips.slice(0, 6),
    matchups: { good: good.slice(0, 3), bad: bad.slice(0, 4) },
    roles,
    winCondition:
      d.winCondition ||
      (combo ? `Assemble ${list(combo.cards)} — ${combo.result.toLowerCase()}` : theme ? WINCON[theme] ?? `Win through ${themeLabel} with ${list(names(topEnd.slice(0, 2)))} as finishers.` : 'Card quality and board presence grind out the win.'),
    strengths: d.strengths.length ? d.strengths : strengths,
    weaknesses: d.weaknesses.length ? d.weaknesses : weaknesses,
  }
}
