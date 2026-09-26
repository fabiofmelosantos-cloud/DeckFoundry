import type { Card } from './types'
import { isCreature, isLand } from './cardDb'

// Synergy tags derived from oracle text and type line. Each tag is either an
// "enabler" (produces a resource) or a "payoff" (rewards it) — pairs across the
// two sides are what makes cards synergise rather than merely share a theme.

export type TagId =
  | 'sacrifice' | 'aristocrats' | 'tokens' | 'counters' | 'lifegain' | 'lifegain-payoff'
  | 'graveyard' | 'self-mill' | 'reanimate' | 'mill' | 'spells' | 'prowess' | 'artifacts'
  | 'draw' | 'ramp' | 'removal' | 'counterspell' | 'wipe' | 'tutor' | 'landfall' | 'lands'
  | 'food' | 'treasure' | 'flying' | 'haste' | 'big' | 'etb' | 'equipment' | 'protection'
  | `tribe:${string}`

export const TAG_LABELS: Record<string, string> = {
  sacrifice: 'Sacrifice outlet', aristocrats: 'Death triggers', tokens: 'Tokens', counters: '+1/+1 counters',
  lifegain: 'Lifegain', 'lifegain-payoff': 'Lifegain payoff', graveyard: 'Graveyard', 'self-mill': 'Self-mill',
  reanimate: 'Recursion', mill: 'Mill', spells: 'Spellslinger', prowess: 'Prowess', artifacts: 'Artifacts',
  draw: 'Card advantage', ramp: 'Ramp', removal: 'Removal', counterspell: 'Counterspell', wipe: 'Board wipe',
  tutor: 'Tutor', landfall: 'Landfall', lands: 'Lands matter', food: 'Food', treasure: 'Treasure',
  flying: 'Flyers', haste: 'Haste', big: 'Big creatures', etb: 'Enters triggers', equipment: 'Equipment',
  protection: 'Protection',
}

export const tagLabel = (t: string) => (t.startsWith('tribe:') ? `${t.slice(6)} tribal` : TAG_LABELS[t] ?? t)

const TRIBES = ['Goblin', 'Elf', 'Zombie', 'Vampire', 'Merfolk', 'Spirit', 'Dragon', 'Human', 'Knight', 'Wizard', 'Cleric', 'Insect', 'Rat', 'Faerie', 'Dinosaur', 'Angel', 'Soldier', 'Squirrel', 'Cat', 'Elemental']

const RULES: [TagId, RegExp][] = [
  ['sacrifice', /sacrifice (a|another|two|X|any number of) (creature|permanent|artifact|food|nontoken)|sacrifice a creature:/i],
  ['aristocrats', /whenever .*\b(a|another|one or more) (other )?(nontoken )?creatures? (you control |an opponent controls )?(dies|die)\b|whenever .* you control dies/i],
  ['tokens', /create[s]? (a|an|two|three|four|X|that many|\w+) .*token/i],
  ['counters', /\+1\/\+1 counter/i],
  ['lifegain', /you gain \d+ life|you gain life|gain (that much|X|\d+) life|lifelink/i],
  ['lifegain-payoff', /whenever you gain life|if you('ve)? gained life/i],
  ['self-mill', /mill (a|two|three|four|\w+) cards?|put the top .* into your graveyard|surveil/i],
  ['mill', /target (player|opponent) mills|each opponent mills|mills? (ten|X|\d+|half)/i],
  ['graveyard', /from your graveyard|cards? in your graveyard|delve|escape|flashback|undergrowth/i],
  ['reanimate', /return (target|a|up to|another|it)?.*from (your|a) graveyard to (the battlefield|your hand)|return .* to the battlefield/i],
  ['spells', /instant or sorcery|noncreature spell|whenever you cast .* (instant|sorcery)/i],
  ['prowess', /prowess/i],
  ['artifacts', /artifact (you control|spell|creature)|for each artifact|whenever an artifact/i],
  ['draw', /draw (a|two|three|X|that many|\w+) cards?|draws? a card/i],
  ['ramp', /add \{|add one mana|search your library for (a|up to two) basic land|put (a|up to one) land card/i],
  ['removal', /destroy target|exile target (creature|nonland|permanent|artifact|enchantment)|deals? \d+ damage to (any target|target creature)|target creature gets -\d|fights? target/i],
  ['counterspell', /counter target/i],
  ['wipe', /destroy all|exile all|deals? \d+ damage to each creature|all creatures get -/i],
  ['tutor', /search your library for (a|an) (card|creature|instant|sorcery|artifact|enchantment)/i],
  ['landfall', /landfall|whenever a land enters|land enters the battlefield under your control/i],
  ['lands', /play (an )?additional land|lands? from your graveyard|return .* land card/i],
  ['food', /\bfood\b/i],
  ['treasure', /\btreasure\b/i],
  ['haste', /\bhaste\b/i],
  ['etb', /when .* enters( the battlefield)?,/i],
  ['equipment', /equip(ped)? /i],
  ['protection', /hexproof|indestructible|phase out|protection from/i],
]

const cache = new Map<string, TagId[]>()

export function tagsOf(c: Card): TagId[] {
  const hit = cache.get(c.id)
  if (hit) return hit
  const tags = new Set<TagId>()
  // Modal double-faced spells: ignore the land back face ("{T}: Add {B}" isn't ramp)
  const faceTypes = c.typeLine.split(' // ')
  const text = faceTypes.length > 1 && !/Land/.test(faceTypes[0])
    ? c.oracleText.split('\n//\n').filter((_, i) => !/Land/.test(faceTypes[i] ?? '')).join('\n')
    : c.oracleText
  if (!isLand(c) || /\{T\}: Add/.test(text) === false) {
    for (const [tag, re] of RULES) if (re.test(text)) tags.add(tag)
  }
  if (isLand(c)) tags.delete('ramp')
  if (c.keywords.includes('Flying')) tags.add('flying')
  if (c.keywords.includes('Haste')) tags.add('haste')
  if (c.keywords.includes('Prowess')) tags.add('prowess')
  if (/Artifact/.test(c.typeLine)) tags.add('artifacts')
  if (isCreature(c) && Number(c.power) >= 5) tags.add('big')
  const type = c.typeLine
  for (const t of TRIBES) {
    const re = new RegExp(`\\b${t}s?\\b`)
    if (re.test(type) || re.test(text)) tags.add(`tribe:${t}`)
  }
  if (tags.has('prowess')) tags.add('spells')
  const out = [...tags]
  cache.set(c.id, out)
  return out
}

// Enabler → payoff pairings that create real synergy.
const PAIRS: [TagId, TagId, string][] = [
  ['tokens', 'sacrifice', 'Tokens are free sacrifice fodder'],
  ['sacrifice', 'aristocrats', 'Every sacrifice triggers a payoff'],
  ['tokens', 'aristocrats', 'Tokens dying feed death triggers'],
  ['lifegain', 'lifegain-payoff', 'Lifegain triggers the payoff'],
  ['self-mill', 'graveyard', 'Milling fuels graveyard payoffs'],
  ['self-mill', 'reanimate', 'Milled creatures come back'],
  ['spells', 'prowess', 'Cheap spells pump prowess'],
  ['counters', 'counters', 'Counters stack and multiply'],
  ['ramp', 'big', 'Ramp into the big threats early'],
  ['food', 'sacrifice', 'Food doubles as sacrifice fodder'],
  ['treasure', 'sacrifice', 'Treasure fuels sacrifice'],
  ['landfall', 'lands', 'Extra land drops mean extra triggers'],
  ['etb', 'reanimate', 'Recurring enters-the-battlefield value'],
  ['mill', 'mill', 'Mill stacks up quickly'],
]

export interface SynergyLink {
  kind: 'combo' | 'synergy' | 'tribal' | 'mechanic' | 'strategy'
  reason: string
  score: number
}

export function synergyBetween(a: Card, b: Card): SynergyLink | null {
  if (a.id === b.id) return null
  const ta = tagsOf(a)
  const tb = tagsOf(b)
  for (const [x, y, why] of PAIRS) {
    if ((ta.includes(x) && tb.includes(y)) || (ta.includes(y) && tb.includes(x))) {
      return { kind: 'synergy', reason: why, score: 3 }
    }
  }
  // Tribal only counts when one side actually cares about the tribe (a lord, a payoff)
  const tribe = ta.find((t) => t.startsWith('tribe:') && tb.includes(t) && new RegExp(`\\b${t.slice(6)}s?\\b`).test(a.oracleText + b.oracleText))
  if (tribe) return { kind: 'tribal', reason: `Both care about ${tribe.slice(6)}s`, score: 2.5 }
  const sharedKw = a.keywords.find((k) => b.keywords.includes(k) && !['Flying', 'Trample', 'Vigilance', 'Reach', 'Haste', 'Deathtouch', 'Lifelink', 'First strike', 'Flash', 'Menace'].includes(k))
  if (sharedKw) return { kind: 'mechanic', reason: `Shared mechanic: ${sharedKw}`, score: 2 }
  const shared = ta.filter((t) => tb.includes(t) && !['removal', 'draw', 'etb', 'flying', 'protection', 'haste', 'big'].includes(t) && !t.startsWith('tribe:'))
  if (shared.length) return { kind: 'strategy', reason: `Same plan: ${tagLabel(shared[0]).toLowerCase()}`, score: 1 + shared.length * 0.5 }
  return null
}
