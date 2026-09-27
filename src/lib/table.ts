import type { Card, Deck } from './types'
import { shuffle } from './random'

// One player's side of the table. Pure state + reducer, shared by solo
// playtesting and online games. No rules engine: players apply the rules.

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command'

export interface Inst {
  uid: number
  card: Card
  zone: Zone
  tapped: boolean
}

export interface TableState {
  cards: Inst[] // library order = array order among library cards (first = top)
  mulligans: number
  phase: 'opening' | 'bottom' | 'play'
  life: number
  poison: number
  cmdDamage: Record<string, number> // commander damage taken, by opponent id
  cmdCasts: number // times the commander was cast from the command zone (tax = 2 × this)
}

export type TableAction =
  | { t: 'deal'; deck: Deck; life: number }
  | { t: 'mulligan'; deck: Deck }
  | { t: 'keep' }
  | { t: 'bottom'; uids: number[] }
  | { t: 'move'; uid: number; to: Zone; where?: 'top' | 'bottom' }
  | { t: 'tap'; uid: number }
  | { t: 'draw'; n: number }
  | { t: 'untapAll' }
  | { t: 'shuffle' }
  | { t: 'life'; delta: number }
  | { t: 'poison'; delta: number }
  | { t: 'cmdDamage'; from: string; delta: number }

export const emptyTable = (life = 20): TableState => ({ cards: [], mulligans: 0, phase: 'opening', life, poison: 0, cmdDamage: {}, cmdCasts: 0 })

function deal(deck: Deck): Inst[] {
  let uid = 0
  const all: Inst[] = []
  for (const dc of deck.cards) for (let i = 0; i < dc.qty; i++) all.push({ uid: uid++, card: dc.card, zone: dc.commander ? 'command' : 'library', tapped: false })
  const lib = shuffle(all.filter((c) => c.zone === 'library'))
  lib.slice(0, 7).forEach((c) => (c.zone = 'hand'))
  return [...all.filter((c) => c.zone === 'command'), ...lib]
}

export function tableReducer(s: TableState, a: TableAction): TableState {
  switch (a.t) {
    case 'deal':
      return { ...emptyTable(a.life), cards: deal(a.deck) }
    case 'mulligan':
      return { ...s, cards: deal(a.deck), mulligans: Math.min(6, s.mulligans + 1), phase: 'opening' }
    case 'keep':
      return { ...s, phase: s.mulligans > 0 ? 'bottom' : 'play' }
    case 'bottom': {
      // London mulligan: chosen cards go to the bottom of the library
      const chosen = s.cards.filter((c) => a.uids.includes(c.uid)).map((c) => ({ ...c, zone: 'library' as Zone }))
      return { ...s, cards: [...s.cards.filter((c) => !a.uids.includes(c.uid)), ...chosen], phase: 'play' }
    }
    case 'move': {
      const c = s.cards.find((x) => x.uid === a.uid)
      if (!c) return s
      const rest = s.cards.filter((x) => x.uid !== a.uid)
      const moved = { ...c, zone: a.to, tapped: false }
      const cast = c.zone === 'command' && a.to === 'battlefield'
      return { ...s, cards: a.where === 'bottom' ? [...rest, moved] : [moved, ...rest], cmdCasts: (s.cmdCasts ?? 0) + (cast ? 1 : 0) }
    }
    case 'tap':
      return { ...s, cards: s.cards.map((x) => (x.uid === a.uid ? { ...x, tapped: !x.tapped } : x)) }
    case 'draw': {
      const top = s.cards.filter((c) => c.zone === 'library').slice(0, a.n).map((c) => c.uid)
      return { ...s, cards: s.cards.map((c) => (top.includes(c.uid) ? { ...c, zone: 'hand' } : c)) }
    }
    case 'untapAll':
      return { ...s, cards: s.cards.map((c) => (c.tapped ? { ...c, tapped: false } : c)) }
    case 'shuffle':
      return { ...s, cards: [...s.cards.filter((c) => c.zone !== 'library'), ...shuffle(s.cards.filter((c) => c.zone === 'library'))] }
    case 'life':
      return { ...s, life: s.life + a.delta }
    case 'poison':
      return { ...s, poison: Math.max(0, s.poison + a.delta) }
    case 'cmdDamage': {
      const v = Math.max(0, (s.cmdDamage[a.from] ?? 0) + a.delta)
      // Commander damage is also regular damage
      return { ...s, cmdDamage: { ...s.cmdDamage, [a.from]: v }, life: s.life - (v - (s.cmdDamage[a.from] ?? 0)) }
    }
  }
}

export const zoneOf = (s: TableState, z: Zone) => s.cards.filter((c) => c.zone === z)

/** A player is out at 0 life, 10 poison or 21 commander damage from one opponent. */
export const isDead = (s: TableState) => s.life <= 0 || s.poison >= 10 || Object.values(s.cmdDamage).some((v) => v >= 21)

// ---- Commander ------------------------------------------------------------------------------
/** A 100-card list is a Commander deck even when no commander is marked yet. */
export const isCommanderDeck = (d: Deck) => !!d.commander || d.cards.reduce((n, c) => n + c.qty, 0) >= 99

/** Cards that can lead the deck: legendary creatures, or cards that say they can be your commander. */
export const commanderOptions = (d: Deck) =>
  d.cards.map((c) => c.card).filter((c) => /Legendary.*Creature/.test(c.typeLine.split(' // ')[0]) || /can be your commander/i.test(c.oracleText))

/** The same deck with one card moved to the command zone. */
export function withCommander(d: Deck, cardId: string): Deck {
  const card = d.cards.find((c) => c.card.id === cardId)?.card
  if (!card) return d
  const cards = d.cards.flatMap((c) =>
    c.card.id !== cardId ? [{ ...c, commander: undefined }] : [{ card: c.card, qty: 1, commander: true }, ...(c.qty > 1 ? [{ card: c.card, qty: c.qty - 1 }] : [])],
  )
  return { ...d, cards, commander: card, format: 'commander' }
}
