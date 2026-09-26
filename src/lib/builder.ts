import type { Card, Color, Deck, DeckCard, DeckMode, Format, Power, Preferences } from './types'
import { CARDS, displayName, findCard, isBasic, isLand, isLegendaryCreature, price } from './cardDb'
import { fillBasics, guildName, sortColors, FORMAT_LABEL } from './analysis'
import { synergyBetween, tagLabel, tagsOf, type TagId } from './tags'
import { mulberry32, pick } from './random'

// Collection-aware deck generator. It only ever selects cards from the card
// database, always prefers cards the user owns, and explains every choice.
// `parsePrompt` is the natural-language layer; an LLM can replace it without
// touching the builder, as long as it returns a BuildRequest.

export interface BuildRequest {
  prompt?: string
  kind: 'commander' | 'constructed'
  onlyOwned: boolean
  budget: number // € allowed to complete (ignored when onlyOwned)
  aroundCard?: Card
  colors?: Color[]
  themes: TagId[]
  weird: boolean
  competitive: boolean
  seed: number
  mode: DeckMode
}

const COLOR_WORDS: [RegExp, Color[]][] = [
  [/\bwhite\b/, ['W']], [/\bblue\b/, ['U']], [/\bblack\b/, ['B']], [/\bred\b/, ['R']], [/\bgreen\b/, ['G']],
  [/azorius/, ['W', 'U']], [/dimir/, ['U', 'B']], [/rakdos/, ['B', 'R']], [/gruul/, ['R', 'G']], [/selesnya/, ['G', 'W']],
  [/orzhov/, ['W', 'B']], [/izzet/, ['U', 'R']], [/golgari/, ['B', 'G']], [/boros/, ['R', 'W']], [/simic/, ['G', 'U']],
  [/esper/, ['W', 'U', 'B']], [/grixis/, ['U', 'B', 'R']], [/jund/, ['B', 'R', 'G']], [/naya/, ['R', 'G', 'W']], [/bant/, ['G', 'W', 'U']],
  [/abzan/, ['W', 'B', 'G']], [/jeskai/, ['U', 'R', 'W']], [/sultai/, ['B', 'G', 'U']], [/mardu/, ['R', 'W', 'B']], [/temur/, ['G', 'U', 'R']],
]
const THEME_WORDS: [RegExp, TagId[]][] = [
  [/sacrific|aristocrat/, ['sacrifice', 'aristocrats']], [/token|go.?wide/, ['tokens']],
  [/graveyard|reanimat|recursion/, ['graveyard', 'self-mill', 'reanimate']], [/life ?gain|lifelink/, ['lifegain', 'lifegain-payoff']],
  [/counters?\b/, ['counters']], [/spell|prowess/, ['spells', 'prowess']], [/artifact/, ['artifacts']], [/goblin/, ['tribe:Goblin']],
  [/\belf|elves/, ['tribe:Elf']], [/zombie/, ['tribe:Zombie']], [/vampire/, ['tribe:Vampire']], [/dragon/, ['tribe:Dragon']],
  [/merfolk/, ['tribe:Merfolk']], [/spirit/, ['tribe:Spirit']], [/fly|flier|flyer|skies/, ['flying']], [/ramp|big|stomp|monster/, ['ramp', 'big']],
  [/\bmill/, ['mill']], [/landfall|lands/, ['landfall', 'lands']], [/treasure/, ['treasure']], [/food/, ['food']],
  [/control|counterspell/, ['counterspell', 'removal', 'draw']], [/aggro|fast/, ['haste']],
]

export function parsePrompt(text: string, prefs: Preferences, seed = Date.now()): BuildRequest {
  const t = text.toLowerCase()
  const budgetMatch = t.match(/(?:under|below|less than|max(?:imum)?|up to|<)\s*€?\s*(\d+)/) ?? t.match(/€\s*(\d+)/) ?? t.match(/(\d+)\s*(?:€|eur|euros?)/)
  const budget = budgetMatch ? Number(budgetMatch[1]) : 0
  const colors = COLOR_WORDS.filter(([re]) => re.test(t)).flatMap(([, c]) => c)
  const themes = THEME_WORDS.filter(([re]) => re.test(t)).flatMap(([, tg]) => tg)
  // Longest card name mentioned in the prompt wins.
  let aroundCard: Card | undefined
  for (const c of CARDS) {
    if (isBasic(c)) continue
    const n = displayName(c).toLowerCase()
    if (n.length >= 4 && t.includes(n) && (!aroundCard || n.length > displayName(aroundCard).length)) aroundCard = c
  }
  const weird = /weird|strange|unexpected|surprise|jank|original|never|wild|chaos/.test(t)
  const competitive = /competitive|meta|tournament|tier|strong|powerful|spike/.test(t) || (!weird && prefs.competition === 'competitive' && !/casual|kitchen|fun/.test(t))
  return {
    prompt: text,
    kind: /commander|\bedh\b|100.card|singleton/.test(t) ? 'commander' : 'constructed',
    onlyOwned: !budget || /only (cards )?i own|from my collection|without buying/.test(t),
    budget,
    aroundCard,
    colors: colors.length ? sortColors(colors) : undefined,
    themes,
    weird,
    competitive,
    seed,
    mode: weird ? 'lab' : competitive ? 'meta' : 'kitchen',
  }
}

// ---- helpers -------------------------------------------------------------------
const subset = (a: Color[], b: Color[]) => a.every((c) => b.includes(c))

export function landColors(c: Card): Color[] {
  const out = new Set<Color>()
  const text = c.oracleText
  if (/any color|basic land card|any type/i.test(text)) return ['W', 'U', 'B', 'R', 'G']
  for (const m of text.matchAll(/\{([WUBRG])\}/g)) out.add(m[1] as Color)
  const basics: [RegExp, Color][] = [[/Plains/, 'W'], [/Island/, 'U'], [/Swamp/, 'B'], [/Mountain/, 'R'], [/Forest/, 'G']]
  for (const [re, col] of basics) if (re.test(c.typeLine) || re.test(text)) out.add(col)
  return [...out]
}

const THEME_NOUN: Record<string, string> = {
  sacrifice: 'Sacrifice', aristocrats: 'Aristocrats', tokens: 'Tokens', counters: 'Counters', lifegain: 'Lifegain',
  'lifegain-payoff': 'Lifegain', graveyard: 'Graveyard', 'self-mill': 'Graveyard', reanimate: 'Recursion', mill: 'Mill',
  spells: 'Spells', prowess: 'Prowess', artifacts: 'Artifacts', ramp: 'Ramp', big: 'Monsters', flying: 'Skies',
  landfall: 'Landfall', lands: 'Lands', food: 'Food', treasure: 'Treasure', counterspell: 'Control', removal: 'Control',
  haste: 'Aggro', draw: 'Value', etb: 'Blink', equipment: 'Voltron', protection: 'Hexproof',
}
const nounFor = (t: TagId) => (t.startsWith('tribe:') ? `${t.slice(6) === 'Elf' ? 'Elve' : t.slice(6)}s` : THEME_NOUN[t] ?? 'Midrange')

export const WINCON: Record<string, string> = {
  sacrifice: 'Drain the table with death triggers while the sacrifice engine keeps running.',
  aristocrats: 'Drain the table with death triggers while the sacrifice engine keeps running.',
  tokens: 'Go wide with tokens, then pump or fling the army for lethal.',
  counters: 'Stack counters on a few threats until they outclass every blocker.',
  lifegain: 'Gain life every turn and convert it into bigger creatures or direct drain.',
  graveyard: 'Turn the graveyard into a second hand and outgrind the opponent.',
  'self-mill': 'Turn the graveyard into a second hand and outgrind the opponent.',
  mill: 'Empty the opponent\'s library before they can race you.',
  spells: 'Cheap spells trigger growing threats; burn and card flow close it out.',
  big: 'Ramp ahead of the curve and land threats the opponent can\'t block.',
  ramp: 'Ramp ahead of the curve and land threats the opponent can\'t block.',
  flying: 'Evasive attackers chip in damage every turn over the top of the board.',
  artifacts: 'Artifact synergies snowball into an overwhelming board.',
  landfall: 'Every land drop triggers value; big landfall turns end the game.',
}

interface Scored {
  card: Card
  score: number
  owned: number
  why: string
}

function baseScore(c: Card, req: BuildRequest, themes: TagId[], owned: number, rand: () => number) {
  const tags = tagsOf(c)
  let s = 0
  for (const t of themes) if (tags.includes(t)) s += 3
  s += owned > 0 ? 4 : -2 - Math.min(3, price(c) / 8)
  if (c.edhrecRank) s += req.weird ? -(1 - c.edhrecRank / 25000) * 1.5 : (1 - Math.min(c.edhrecRank, 25000) / 25000) * 2
  if (req.competitive) s += Math.min(2, Math.log10(price(c) + 1)) - Math.max(0, c.cmc - 4) * 0.6
  if (req.kind === 'constructed' && c.cmc >= 6) s -= 1.5
  if (req.weird) s += rand() * 4
  else s += rand() * 0.6
  return s
}

// ---- main entry ------------------------------------------------------------------
export function buildDeck(req: BuildRequest, owned: Map<string, number>, prefs: Preferences): Deck {
  return req.kind === 'commander' ? buildCommander(req, owned, prefs) : buildConstructed(req, owned, prefs)
}

function pickColorsAndThemes(req: BuildRequest, owned: Map<string, number>, prefs: Preferences, rand: () => number) {
  let colors = req.colors
  let themes = [...req.themes]
  if (req.aroundCard) {
    colors ??= req.aroundCard.colorIdentity.length ? [...req.aroundCard.colorIdentity] : undefined
    if (!themes.length) themes = tagsOf(req.aroundCard).filter((t) => !['removal', 'draw', 'etb', 'protection', 'haste', 'flying'].includes(t)).slice(0, 3)
  }
  if (!themes.length) {
    // Most-supported theme among owned cards, nudged by preferred play styles.
    const styleMap: Record<string, TagId[]> = { graveyard: ['graveyard', 'self-mill'], tokens: ['tokens'], combo: ['sacrifice', 'aristocrats'], tribal: ['tribe:Goblin', 'tribe:Elf', 'tribe:Zombie'], aggro: ['haste', 'prowess'], control: ['counterspell'], midrange: ['counters'], weird: ['mill', 'food'] }
    const counts = new Map<TagId, number>()
    for (const [name, q] of owned) {
      if (q <= 0) continue
      const c = findCard(name)
      if (!c || isLand(c)) continue
      for (const t of tagsOf(c)) if (!['removal', 'draw', 'etb', 'ramp', 'protection', 'flying', 'haste', 'big'].includes(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    for (const st of prefs.styles) for (const t of styleMap[st] ?? []) counts.set(t, (counts.get(t) ?? 0) * 1.3 + 2)
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
    themes = req.weird ? [pick(ranked.slice(3, 14), rand), pick(ranked.slice(0, 12), rand)] : ranked.slice(0, 2)
    themes = [...new Set(themes)]
  }
  if (!colors) {
    // Colour pair with the most owned cards matching the themes.
    const pairs: Color[][] = [['W', 'U'], ['U', 'B'], ['B', 'R'], ['R', 'G'], ['G', 'W'], ['W', 'B'], ['U', 'R'], ['B', 'G'], ['R', 'W'], ['G', 'U']]
    const scored = pairs.map((p) => {
      let s = 0
      for (const [name, q] of owned) {
        if (q <= 0) continue
        const c = findCard(name)
        if (!c || isLand(c) || !c.colorIdentity.length || !subset(c.colorIdentity, p)) continue
        s += 1 + tagsOf(c).filter((t) => themes.includes(t)).length * 3
      }
      if (prefs.colors.some((c) => p.includes(c))) s *= 1.15
      return { p, s: s * (req.weird ? 0.6 + rand() : 1) }
    })
    colors = scored.sort((a, b) => b.s - a.s)[0].p
  }
  return { colors: sortColors(colors), themes: themes as TagId[] }
}

function explain(deck: Deck, picks: Scored[], owned: Map<string, number>, themes: TagId[], extra: string[]) {
  const nonland = deck.cards.filter((c) => !isLand(c.card))
  const count = (tg: TagId) => nonland.filter((c) => tagsOf(c.card).includes(tg)).reduce((a, c) => a + c.qty, 0)
  const nonlandQty = nonland.reduce((a, c) => a + c.qty, 0)
  const avg = nonland.reduce((a, c) => a + c.card.cmc * c.qty, 0) / Math.max(1, nonlandQty)
  const ownedQty = deck.cards.reduce((a, c) => a + (isBasic(c.card) ? c.qty : Math.min(c.qty, owned.get(c.card.name) ?? 0)), 0)
  const total = deck.cards.reduce((a, c) => a + c.qty, 0)

  // Strongest pairwise synergies among the key picks
  const top = picks.slice(0, 14)
  const pairs: { a: Card; b: Card; why: string; s: number }[] = []
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      const l = synergyBetween(top[i].card, top[j].card)
      if (l && l.kind !== 'strategy') pairs.push({ a: top[i].card, b: top[j].card, why: l.reason, s: l.score + top[i].score / 10 + top[j].score / 10 })
    }
  pairs.sort((a, b) => b.s - a.s)
  const usedPair = new Set<string>()
  const synergyLines: string[] = []
  for (const p of pairs) {
    if (usedPair.has(p.a.name) || usedPair.has(p.b.name)) continue
    usedPair.add(p.a.name)
    usedPair.add(p.b.name)
    synergyLines.push(`${displayName(p.a)} + ${displayName(p.b)} — ${p.why.toLowerCase()}.`)
    if (synergyLines.length >= 3) break
  }

  const removal = count('removal') + count('counterspell') + count('wipe')
  const draw = count('draw')
  const ramp = count('ramp')
  const strengths: string[] = []
  const weaknesses: string[] = []
  if (removal >= (deck.commander ? 8 : 7)) strengths.push(`Plenty of interaction (${removal} answers)`)
  else weaknesses.push(`Light on interaction — only ${removal} answers`)
  if (draw >= (deck.commander ? 8 : 5)) strengths.push(`Solid card advantage (${draw} sources)`)
  else weaknesses.push('Can run out of cards in long games')
  if (avg <= 2.6) strengths.push(`Low curve (avg ${avg.toFixed(1)}) — fast, consistent starts`)
  if (avg >= 3.6) weaknesses.push(`Top-heavy curve (avg ${avg.toFixed(1)}) — vulnerable to fast decks`)
  if (deck.colors.length >= 3) weaknesses.push('Three colours strain the mana base')
  if (themes.some((t) => ['graveyard', 'self-mill', 'reanimate'].includes(t))) weaknesses.push('Graveyard hate is a real problem')
  if (themes.includes('tokens')) weaknesses.push('Board wipes reset the plan')
  if (strengths.length < 2) strengths.push(`Focused ${themes.map(tagLabel).join(' + ').toLowerCase()} game plan`)

  const reasoning = [
    `Built from ${ownedQty} of ${total} cards you already own (${Math.round((ownedQty / total) * 100)}%).`,
    `Core plan: ${themes.map(tagLabel).join(' + ').toLowerCase() || 'value midrange'} in ${guildName(deck.colors)}.`,
    ...synergyLines,
    `${removal} interaction · ${draw} card draw · ${ramp} ramp · average mana value ${avg.toFixed(1)}.`,
    ...extra,
  ]
  const winCondition = WINCON[themes[0]] ?? (themes[0]?.startsWith('tribe:') ? `Build a ${themes[0].slice(6)} board and overrun with tribal bonuses.` : 'Card quality and board presence grind out the win.')
  return { reasoning, strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3), winCondition }
}

function powerOf(deck: Deck, competitive: boolean): Power {
  const nonland = deck.cards.filter((c) => !isLand(c.card))
  const avgPrice = nonland.reduce((a, c) => a + price(c.card) * c.qty, 0) / Math.max(1, nonland.reduce((a, c) => a + c.qty, 0))
  if (competitive && avgPrice > 4) return 'Competitive'
  if (avgPrice > 3) return 'High Power'
  if (avgPrice > 0.9) return 'Mid Power'
  return 'Casual'
}

function chooseLands(colors: Color[], owned: Map<string, number>, onlyOwned: boolean, max: number, singleton: boolean, format?: Format) {
  const out: DeckCard[] = []
  const lands = CARDS.filter((c) => isLand(c) && !isBasic(c) && !c.isNew)
    .filter((c) => (format ? ['legal', 'restricted'].includes(c.legalities[format]) : true))
    .map((c) => ({ c, lc: landColors(c), o: owned.get(c.name) ?? 0 }))
    .filter(({ c, lc }) => lc.length > 0 && c.colorIdentity.every((x) => colors.includes(x)) && lc.filter((x) => colors.includes(x)).length >= Math.min(2, colors.length))
    .filter(({ o }) => !onlyOwned || o > 0)
    .sort((a, b) => b.o - a.o || (b.c.edhrecRank ? 1 / b.c.edhrecRank : 0) - (a.c.edhrecRank ? 1 / a.c.edhrecRank : 0))
  let n = 0
  for (const { c, o } of lands) {
    if (n >= max) break
    if (c.name === 'Command Tower' && colors.length < 2) continue
    const q = singleton ? 1 : Math.min(4, onlyOwned ? o : 4, max - n)
    if (q <= 0) continue
    out.push({ card: c, qty: q })
    n += q
  }
  return out
}

function buildConstructed(req: BuildRequest, owned: Map<string, number>, prefs: Preferences): Deck {
  const rand = mulberry32(req.seed)
  const { colors, themes } = pickColorsAndThemes(req, owned, prefs, rand)
  const format: Format | undefined = req.competitive ? (prefs.formats.find((f) => f !== 'commander') ?? 'modern') : undefined
  const candidates = CARDS.filter(
    (c) => !isLand(c) && !isBasic(c) && subset(c.colorIdentity, colors) && (!format || c.legalities[format] === 'legal') && (!req.onlyOwned || (owned.get(c.name) ?? 0) > 0),
  )
  let scored: Scored[] = candidates.map((c) => {
    const o = owned.get(c.name) ?? 0
    return { card: c, owned: o, score: baseScore(c, req, themes, o, rand), why: '' }
  })
  if (req.aroundCard) {
    const anchor = req.aroundCard
    scored = scored.map((s) => {
      const l = synergyBetween(anchor, s.card)
      return l ? { ...s, score: s.score + l.score * 1.6, why: l.reason } : s
    })
  }
  scored.sort((a, b) => b.score - a.score)
  const anchors = scored.slice(0, 4).map((s) => s.card)
  scored = scored
    .map((s) => {
      let bonus = 0
      for (const a of anchors) bonus += synergyBetween(a, s.card)?.score ?? 0
      return { ...s, score: s.score + bonus * 0.5 }
    })
    .sort((a, b) => b.score - a.score)

  const picks: Scored[] = []
  const cards: DeckCard[] = []
  let nonland = 0
  let spent = 0
  const TARGET = 36
  const around = req.aroundCard && !isLand(req.aroundCard) ? scored.find((s) => s.card.id === req.aroundCard!.id) : undefined
  const ordered = around ? [around, ...scored.filter((s) => s !== around)] : scored
  // Guarantee a minimum of interaction
  const interaction = ordered.filter((s) => tagsOf(s.card).some((t) => t === 'removal' || t === 'counterspell')).slice(0, 3)
  const queue = [...ordered.slice(0, 3), ...interaction, ...ordered.slice(3)]
  const seen = new Set<string>()
  for (const s of queue) {
    if (nonland >= TARGET) break
    if (seen.has(s.card.id)) continue
    seen.add(s.card.id)
    const legendary = /Legendary/.test(s.card.typeLine)
    const want = picks.length < 8 ? (legendary ? 2 : 4) : picks.length < 14 ? 3 : 2
    let qty = Math.min(want, TARGET - nonland)
    if (req.onlyOwned) qty = Math.min(qty, s.owned)
    else {
      const extra = Math.max(0, qty - s.owned) * price(s.card)
      if (spent + extra > req.budget) qty = Math.min(qty, s.owned)
      else spent += extra
    }
    if (qty <= 0) continue
    picks.push(s)
    cards.push({ card: s.card, qty })
    nonland += qty
  }
  const lands = chooseLands(colors, owned, req.onlyOwned, colors.length > 1 ? 8 : 0, false, format)
  let list: DeckCard[] = [...cards, ...lands]
  list = fillBasics(list, colors, 60)
  const extra: string[] = []
  if (nonland < TARGET) extra.push(`Your collection only has ${nonland} playable spells for this plan, so the rest of the deck is lands — add more ${guildName(colors)} cards to sharpen it.`)
  if (!req.onlyOwned && spent > 0) extra.push(`Upgrades chosen to stay within your €${req.budget} budget (€${spent.toFixed(2)} to complete).`)

  const lead = req.aroundCard ? displayName(req.aroundCard).split(',')[0] : undefined
  const deck: Deck = {
    id: `ai-${req.seed.toString(36)}`,
    name: lead ? `${lead} ${nounFor(themes[0] ?? 'draw')}` : `${guildName(colors)} ${nounFor(themes[0] ?? 'draw')}`,
    colors,
    format: format ?? 'casual',
    mode: req.mode,
    power: 'Casual',
    strategy: themes.map(tagLabel).join(' + ') || 'Midrange',
    tagline: req.weird ? 'Something nobody at your table will see coming.' : `A ${themes.map(tagLabel).join(' / ').toLowerCase()} deck built around what you already own.`,
    description: '',
    cards: list,
    keyCards: picks.slice(0, 4).map((p) => p.card.name),
    winCondition: '',
    strengths: [],
    weaknesses: [],
    origin: 'ai',
    prompt: req.prompt,
  }
  deck.power = powerOf(deck, req.competitive)
  const ex = explain(deck, picks, owned, themes, extra)
  Object.assign(deck, ex)
  deck.description = `${deck.keyCards.map((n) => n.split(' // ')[0]).slice(0, 3).join(', ')} lead a ${guildName(colors)} ${themes.map(tagLabel).join(' + ').toLowerCase()} strategy${format ? `, legal in ${FORMAT_LABEL[format]}` : ''}.`
  return deck
}

export function commanderCandidates(owned: Map<string, number>) {
  return CARDS.filter((c) => isLegendaryCreature(c) && c.legalities.commander === 'legal' && (owned.get(c.name) ?? 0) > 0)
}

function buildCommander(req: BuildRequest, owned: Map<string, number>, prefs: Preferences): Deck {
  const rand = mulberry32(req.seed)
  let commander = req.aroundCard && isLegendaryCreature(req.aroundCard) ? req.aroundCard : undefined
  const pool = (identity: Color[]) =>
    CARDS.filter((c) => !isLand(c) && !isBasic(c) && c.legalities.commander === 'legal' && subset(c.colorIdentity, identity) && (!req.onlyOwned || (owned.get(c.name) ?? 0) > 0))

  if (!commander) {
    const options = commanderCandidates(owned).filter((c) => (!req.colors || subset(req.colors, c.colorIdentity)) && c.colorIdentity.length > 0)
    const ranked = options
      .map((cmd) => {
        const p = pool(cmd.colorIdentity)
        let s = 0
        for (const c of p) {
          const l = synergyBetween(cmd, c)
          s += (l?.score ?? 0) + ((owned.get(c.name) ?? 0) > 0 ? 0.4 : 0) + tagsOf(c).filter((t) => req.themes.includes(t)).length * 2
        }
        if (prefs.colors.some((c) => cmd.colorIdentity.includes(c))) s *= 1.1
        // Bigger colour identities see more cards; normalise so 2–3 colour commanders compete fairly
        s /= 1 + Math.max(0, cmd.colorIdentity.length - 2) * 0.45
        return { cmd, s: s * (req.weird ? 0.4 + rand() * 1.2 : 1) }
      })
      .sort((a, b) => b.s - a.s)
    commander = (req.weird ? pick(ranked.slice(0, 6), rand) : ranked[0])?.cmd
  }
  if (!commander) throw new Error('No legendary creature in your collection can lead a Commander deck yet.')

  const identity = commander.colorIdentity
  const cmdTags = tagsOf(commander).filter((t) => !['removal', 'draw', 'etb', 'protection', 'haste', 'flying'].includes(t))
  const themes = (req.themes.length ? req.themes : cmdTags.slice(0, 3)) as TagId[]
  const scored: Scored[] = pool(identity)
    .filter((c) => c.id !== commander!.id)
    .map((c) => {
      const o = owned.get(c.name) ?? 0
      const l = synergyBetween(commander!, c)
      return { card: c, owned: o, score: baseScore(c, req, themes, o, rand) + (l?.score ?? 0) * 1.8, why: l?.reason ?? '' }
    })
    .sort((a, b) => b.score - a.score)

  const chosen = new Map<string, Scored>()
  let spent = 0
  const take = (s: Scored) => {
    if (chosen.has(s.card.id) || chosen.size >= 62) return
    if (s.owned <= 0) {
      if (req.onlyOwned || spent + price(s.card) > req.budget) return
      spent += price(s.card)
    }
    chosen.set(s.card.id, s)
  }
  const quota = (tag: TagId, n: number) => scored.filter((s) => tagsOf(s.card).includes(tag)).slice(0, n).forEach(take)
  quota('ramp', 10)
  quota('draw', 9)
  quota('removal', 7)
  quota('wipe', 2)
  for (const s of scored) take(s)

  const picks = [...chosen.values()].sort((a, b) => b.score - a.score)
  const cards: DeckCard[] = [{ card: commander, qty: 1, commander: true }, ...picks.map((p) => ({ card: p.card, qty: 1 }))]
  const nonbasicLands = chooseLands(identity, owned, req.onlyOwned, 14, true, 'commander')
  let list = [...cards, ...nonbasicLands]
  list = fillBasics(list, identity.length ? identity : ['W'], 100)
  const extra: string[] = []
  if (picks.length < 62) extra.push(`Only ${picks.length} of your cards fit ${displayName(commander)}'s colours, so the deck runs extra basics. Every new ${guildName(identity)} card you add makes it better.`)
  if (spent > 0) extra.push(`Includes €${spent.toFixed(2)} of upgrades within your €${req.budget} budget.`)

  const deck: Deck = {
    id: `cmd-${commander.id.slice(0, 8)}-${req.seed.toString(36)}`,
    name: `${displayName(commander).split(',')[0]} ${nounFor(themes[0] ?? 'draw')}`,
    colors: sortColors(identity),
    format: 'commander',
    mode: 'commander',
    power: 'Casual',
    strategy: themes.map(tagLabel).join(' + ') || 'Commander value',
    tagline: `${displayName(commander)} leads a ${guildName(identity)} ${themes.map(tagLabel).join(' / ').toLowerCase()} deck.`,
    description: '',
    cards: list,
    commander,
    keyCards: [commander.name, ...picks.slice(0, 3).map((p) => p.card.name)],
    winCondition: '',
    strengths: [],
    weaknesses: [],
    origin: 'ai',
    prompt: req.prompt,
  }
  deck.power = powerOf(deck, req.competitive)
  Object.assign(deck, explain(deck, picks, owned, themes, extra))
  deck.description = `A 100-card singleton deck led by ${displayName(commander)}, built around ${themes.map(tagLabel).join(' and ').toLowerCase()}.`
  return deck
}

/** Random-but-coherent experiment for The Lab / Surprise Me. */
export function experimentRequest(prefs: Preferences, seed: number, surprise = false): BuildRequest {
  const rand = mulberry32(seed)
  return {
    kind: surprise && rand() < 0.35 ? 'commander' : 'constructed',
    onlyOwned: false,
    budget: surprise ? 25 : Math.max(8, Math.round(prefs.budget / 3)),
    themes: [],
    weird: true,
    competitive: false,
    seed,
    mode: 'lab',
  }
}

