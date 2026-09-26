import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bot, Bookmark, BookmarkCheck, Copy, Download, Play, ShoppingBag, Sparkles, Wand2, Crown, Swords, ShieldAlert, Trophy, ArrowLeft, RefreshCw, Plus, Minus } from 'lucide-react'
import type { Card, DeckAnalysis, DeckCard } from '../lib/types'
import { useDiscovery } from '../lib/discovery'
import { saveDeck, unsaveDeck, useStore } from '../lib/store'
import { cardsAway, FORMAT_LABEL, guildName } from '../lib/analysis'
import { CARDS, displayName, isBasic, isLand, price, primaryType } from '../lib/cardDb'
import { deckHighlights } from '../lib/insights'
import { synergyBetween, tagLabel, tagsOf } from '../lib/tags'
import { generateFromPrompt } from '../lib/generate'
import { ManaCurve, TypeBars } from '../components/Charts'
import { StrategyGuide } from '../components/StrategyGuide'
import { buildGuide } from '../lib/guide'
import { ArtCrop, CardImage, Empty, ManaCost, ManaPips, OwnershipLegend, Pill, PowerBadge, Ring, SectionHeader, Sheet, StatusTag, cx, eur, toast } from '../components/ui'

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land']

export default function DeckView() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const disc = useDiscovery()
  const a = disc.byId.get(id ?? '')
  const missingRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const [improving, setImproving] = useState(false)
  const [visual, setVisual] = useState(false)

  useEffect(() => {
    if (params.get('missing') && missingRef.current) setTimeout(() => missingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
  }, [params, a?.deck.id])

  if (!a) {
    return <Empty icon={<ShieldAlert size={22} />} title="Deck not found" text="This deck may have been generated in another browser." action={<Link to="/discover" className="btn btn-primary">Back to Discover</Link>} />
  }

  const d = a.deck
  const saved = disc.savedIds.has(d.id)
  const hero = d.commander ?? d.cards.find((c) => c.card.name === d.keyCards[0])?.card ?? d.cards[0].card
  const highlights = deckHighlights(a, 4)
  const guide = buildGuide(a)
  const away = cardsAway(a)
  const keyCards = d.keyCards.map((n) => d.cards.find((c) => c.card.name === n)?.card).filter(Boolean) as Card[]
  const legal = a.legalIn.filter((f) => f !== 'vintage')
  const formatLabel = d.format === 'casual' ? (legal[0] ? `Casual · ${FORMAT_LABEL[legal[legal.length - 1]]}-legal` : 'Casual') : FORMAT_LABEL[d.format]
  const formatOk = d.format === 'casual' || a.legalIn.includes(d.format)

  return (
    <div className="space-y-8 md:space-y-10">
      {/* Header */}
      <section className="relative -mx-4 md:mx-0 md:rounded-[28px] overflow-hidden -mt-6 md:mt-0">
        <ArtCrop card={hero} className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/80 to-ink-950/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/80 to-transparent" />
        <div className="relative px-4 md:px-10 pt-6 pb-8 md:pt-10 md:pb-10">
          <Link to="/discover" className="inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg mb-16 md:mb-24">
            <ArrowLeft size={15} /> Discover
          </Link>
          {params.get('new') && (
            <div className="mb-3">
              <StatusTag kind="disc">{d.mode === 'lab' ? `Fresh from the Lab — Experiment #${String(d.experiment ?? '').padStart(3, '0')}` : 'Just built for you'}</StatusTag>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <ManaPips colors={d.colors} size={20} />
            <span className="text-sm text-fg-2 ml-1">{guildName(d.colors)}</span>
            <PowerBadge power={d.power} />
            <Pill>{formatLabel}</Pill>
            {!formatOk && <Pill className="text-need border-need/30">Not {FORMAT_LABEL[d.format]}-legal</Pill>}
            <Pill>{d.strategy}</Pill>
          </div>
          <h1 className="display text-5xl md:text-7xl mb-2">{d.name}</h1>
          <p className="text-fg-2 max-w-xl">{d.tagline}</p>
          {d.commander && (
            <div className="flex items-center gap-2 mt-4 text-sm">
              <Crown size={15} className="text-gold" /> Commander: <Link to={`/card/${d.commander.id}`} className="font-medium hover:text-gold">{d.commander.name}</Link>
            </div>
          )}
          {d.prompt && <p className="text-sm text-fg-3 mt-3 italic">“{d.prompt}”</p>}
        </div>
      </section>

      {/* Readiness + actions */}
      <section className="grid lg:grid-cols-[1fr_auto] gap-4 items-stretch">
        <div className="panel p-5 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Ring pct={a.pct} size={72} stroke={6} />
          <Metric label="Cards owned" value={`${a.owned}/${a.total}`} tone="own" />
          <Metric label="Missing" value={away ? String(away) : '—'} tone={away ? 'need' : undefined} />
          <Metric label="To complete" value={a.costToComplete ? eur(a.costToComplete) : '€0'} tone={a.costToComplete ? 'need' : 'own'} />
          <Metric label="Deck value" value={eur(a.deckValue, 0)} />
          {a.combos.length > 0 && <Metric label="Combos" value={String(a.combos.length)} tone="disc" />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2">
          <Link to={`/deck/${d.id}/test`} className="btn btn-primary col-span-2 sm:col-span-1 lg:col-span-2 xl:col-span-1">
            <Play size={16} /> Test deck
          </Link>
          <Link to={`/deck/${d.id}/bot`} className="btn btn-ghost">
            <Bot size={16} /> Play vs bot
          </Link>
          <Link to={`/play?deck=${d.id}`} className="btn btn-ghost">
            <Swords size={16} /> Play online
          </Link>
          <button className="btn btn-ghost" onClick={() => setImproving(true)}>
            <Wand2 size={16} /> Improve
          </button>
          <button className="btn btn-ghost" onClick={() => missingRef.current?.scrollIntoView({ behavior: 'smooth' })} disabled={!away}>
            <ShoppingBag size={16} /> Missing
          </button>
          <button className="btn btn-ghost" onClick={() => setExporting(true)}>
            <Download size={16} /> Export
          </button>
          <button
            className={cx('btn btn-ghost', saved && 'text-gold border-gold/40')}
            onClick={() => {
              if (saved) unsaveDeck(d.id)
              else {
                saveDeck(d)
                toast(<>Saved <b>{d.name}</b></>, { label: 'My decks', to: '/decks' })
              }
            }}
          >
            {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </section>

      <StrategyGuide guide={guide} />

      {/* Why this deck */}
      <section className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="panel p-5 md:p-7">
          <div className="eyebrow mb-2">Why this deck?</div>
          <p className="text-[17px] leading-relaxed mb-6">{d.description}</p>
          {highlights.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mb-3">Key synergies</h3>
              <ul className="space-y-3 mb-7">
                {highlights.map((h, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="flex -space-x-5 shrink-0">
                      <CardImage card={h.a} small className="w-10 ring-2 ring-ink-850" />
                      <CardImage card={h.b} small className="w-10 ring-2 ring-ink-850" />
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{displayName(h.a)}</span> <span className="text-fg-3">+</span> <span className="font-medium">{displayName(h.b)}</span>
                      {h.combo && <StatusTag kind="disc" className="ml-2 align-middle">Combo</StatusTag>}
                      <div className="text-fg-3">{h.text}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Trophy size={14} className="text-gold" /> Win condition
              </h3>
              <p className="text-sm text-fg-2">{guide.winCondition}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Swords size={14} className="text-gold" /> Curve
              </h3>
              <p className="text-sm text-fg-2">{curveSummary(a)}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2 text-own">Strengths</h3>
              <ul className="text-sm text-fg-2 space-y-1">
                {guide.strengths.map((s) => (
                  <li key={s}>+ {s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2 text-need">Weaknesses</h3>
              <ul className="text-sm text-fg-2 space-y-1">
                {guide.weaknesses.map((s) => (
                  <li key={s}>− {s}</li>
                ))}
              </ul>
            </div>
          </div>
          {d.reasoning && (
            <div className="mt-7 pt-5 border-t hairline">
              <div className="flex items-center gap-2 text-disc text-sm font-semibold mb-3">
                <Sparkles size={14} /> How the AI built it
              </div>
              <ul className="space-y-1.5 text-sm text-fg-2">
                {d.reasoning.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-fg-3 num">{String(i + 1).padStart(2, '0')}</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="panel p-5">
            <div className="eyebrow mb-4">Key cards</div>
            <div className="grid grid-cols-4 gap-2">
              {keyCards.slice(0, 4).map((c) => (
                <Link key={c.id} to={`/card/${c.id}`} className="lift">
                  <CardImage card={c} small />
                </Link>
              ))}
            </div>
          </div>
          <div className="panel p-5">
            <div className="eyebrow mb-4">Mana curve</div>
            <ManaCurve curve={a.curve} />
          </div>
          <div className="panel p-5">
            <div className="eyebrow mb-4">Card types</div>
            <TypeBars types={a.types} />
          </div>
        </div>
      </section>

      {/* Combos */}
      {a.combos.length > 0 && (
        <section className="panel p-5 md:p-6 border-disc/20 bg-gradient-to-br from-disc/[.06] to-transparent">
          <SectionHeader eyebrow="New discoveries" title={`${a.combos.length} combo${a.combos.length > 1 ? 's' : ''} hiding in this list`} />
          <div className="grid md:grid-cols-2 gap-3">
            {a.combos.map((cb) => (
              <div key={cb.cards.join()} className="rounded-2xl bg-black/20 border border-white/5 p-4">
                <div className="font-medium text-sm mb-1">{cb.cards.join(' + ')}</div>
                <div className="text-sm text-fg-3">{cb.result}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Complete the deck */}
      {a.missing.length > 0 && (
        <section ref={missingRef} className="scroll-mt-20">
          <MissingSection a={a} />
        </section>
      )}

      {/* Decklist */}
      <section>
        <SectionHeader
          eyebrow="Decklist"
          title={`${a.total} cards`}
          action={
            <div className="flex rounded-full border border-white/10 p-1 text-sm">
              <button className={cx('px-3 h-8 rounded-full', !visual && 'bg-white/10')} onClick={() => setVisual(false)}>
                List
              </button>
              <button className={cx('px-3 h-8 rounded-full', visual && 'bg-white/10')} onClick={() => setVisual(true)}>
                Visual
              </button>
            </div>
          }
        />
        <div className="mb-4">
          <OwnershipLegend />
        </div>
        <Decklist a={a} visual={visual} />
      </section>

      <ExportSheet open={exporting} onClose={() => setExporting(false)} a={a} />
      <ImproveSheet open={improving} onClose={() => setImproving(false)} a={a} />
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'own' | 'need' | 'disc' }) {
  return (
    <div>
      <div className="text-[11px] text-fg-3 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={cx('num text-xl font-semibold', tone === 'own' && 'text-own', tone === 'need' && 'text-need', tone === 'disc' && 'text-disc')}>{value}</div>
    </div>
  )
}

function curveSummary(a: DeckAnalysis) {
  const nonland = a.curve.reduce((x, y) => x + y, 0)
  const avg = a.curve.reduce((s, n, i) => s + n * i, 0) / Math.max(1, nonland)
  const early = a.curve[1] + a.curve[2]
  const lands = a.types.Land ?? 0
  return `Average mana value ${avg.toFixed(2)}. ${early} plays at one or two mana, ${lands} lands. ${avg < 2.4 ? 'Built to be fast.' : avg < 3.3 ? 'A balanced midrange curve.' : 'Plans to go long — protect the early turns.'}`
}

function ownedStatus(dc: DeckCard, owned: Map<string, number>) {
  if (isBasic(dc.card)) return { have: dc.qty, missing: 0 }
  const have = Math.min(dc.qty, owned.get(dc.card.name) ?? 0)
  return { have, missing: dc.qty - have }
}

function Decklist({ a, visual }: { a: DeckAnalysis; visual: boolean }) {
  const disc = useDiscovery()
  const groups = useMemo(() => {
    const g = new Map<string, DeckCard[]>()
    for (const dc of a.deck.cards) {
      const t = dc.commander ? 'Commander' : primaryType(dc.card)
      g.set(t, [...(g.get(t) ?? []), dc])
    }
    for (const l of g.values()) l.sort((x, y) => x.card.cmc - y.card.cmc || x.card.name.localeCompare(y.card.name))
    return ['Commander', ...TYPE_ORDER, 'Other'].filter((t) => g.has(t)).map((t) => [t, g.get(t)!] as const)
  }, [a])

  if (visual) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-3">
        {a.deck.cards.map((dc) => {
          const s = ownedStatus(dc, disc.owned)
          return (
            <Link key={dc.card.id} to={`/card/${dc.card.id}`} className="lift">
              <CardImage card={dc.card} small className={cx(s.missing && 'opacity-60 ring-2 ring-need/60')}>
                <span className="absolute top-1.5 left-1.5 num text-[11px] font-semibold h-5 min-w-5 px-1 rounded-full bg-black/80 flex items-center justify-center">{dc.qty}</span>
                {s.missing > 0 && <span className="absolute bottom-1.5 inset-x-1.5 text-center text-[10px] font-medium rounded-full bg-need text-ink-950 py-0.5">Need {s.missing}</span>}
              </CardImage>
            </Link>
          )
        })}
      </div>
    )
  }
  return (
    <div className="columns-1 md:columns-2 xl:columns-3 gap-4 [column-fill:_balance]">
      {groups.map(([type, cards]) => (
        <div key={type} className="panel p-4 mb-4 break-inside-avoid">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-semibold">{type}</span>
            <span className="text-fg-3 num">{cards.reduce((x, c) => x + c.qty, 0)}</span>
          </div>
          <ul>
            {cards.map((dc) => {
              const s = ownedStatus(dc, disc.owned)
              return (
                <li key={dc.card.id}>
                  <Link to={`/card/${dc.card.id}`} className="flex items-center gap-2 py-1.5 text-sm group">
                    <span className="num w-5 text-fg-3">{dc.qty}</span>
                    <span className={cx('flex-1 truncate group-hover:text-gold', s.missing && 'text-fg-2')}>{displayName(dc.card)}</span>
                    {!isLand(dc.card) && <ManaCost cost={dc.card.manaCost} size={13} />}
                    {s.missing ? (
                      <StatusTag kind="need" className="h-5">
                        {s.missing}
                      </StatusTag>
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-own/10 text-own flex items-center justify-center" title="Owned">
                        ✓
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function MissingSection({ a }: { a: DeckAnalysis }) {
  const away = cardsAway(a)
  const upgrades = [...a.missing].sort((x, y) => y.impact / Math.max(0.3, y.cost) - x.impact / Math.max(0.3, x.cost)).slice(0, 4)
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <div className="panel p-5 md:p-7 border-need/20">
        <div className="eyebrow text-need mb-2">Complete the deck</div>
        <h2 className="display text-4xl md:text-5xl mb-1">
          You're {away} card{away > 1 ? 's' : ''} away.
        </h2>
        <p className="text-fg-3 mb-6">
          Total <span className="text-need num">{eur(a.costToComplete)}</span> · sorted by importance to the deck
        </p>
        <ul className="divide-y divide-white/5">
          {a.missing.map((m) => (
            <li key={m.card.id} className="flex items-center gap-3 py-3">
              <Link to={`/card/${m.card.id}`}>
                <CardImage card={m.card} small className="w-11" />
              </Link>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{displayName(m.card)}</div>
                <div className="text-xs text-fg-3">
                  {m.role} · need {m.need}
                  {m.owned > 0 && <span className="text-own"> (own {m.owned})</span>}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="h-1 w-24 rounded-full bg-white/[.06] overflow-hidden">
                    <div className="h-full bg-need rounded-full" style={{ width: `${m.impact}%` }} />
                  </div>
                  <span className="text-[11px] text-fg-3">{m.impact >= 85 ? 'Critical' : m.impact >= 65 ? 'Important' : 'Nice to have'}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="num text-sm">{eur(m.cost)}</div>
                <div className="num text-[11px] text-fg-3">{eur(price(m.card))} ea</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel p-5 md:p-6 self-start">
        <div className="eyebrow mb-1">Best upgrades</div>
        <p className="text-sm text-fg-3 mb-4">Most impact per euro spent.</p>
        <ol className="space-y-3">
          {upgrades.map((m, i) => (
            <li key={m.card.id} className="flex items-center gap-3">
              <span className="display text-3xl text-fg-3 w-6">{i + 1}</span>
              <CardImage card={m.card} small className="w-10" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{displayName(m.card)}</div>
                <div className="text-xs text-fg-3">{m.role}</div>
              </div>
              <StatusTag kind="need">{eur(m.cost)}</StatusTag>
            </li>
          ))}
        </ol>
        <Link to="/buy" className="btn btn-ghost w-full mt-5">
          <ShoppingBag size={15} /> Smart buy list
        </Link>
      </div>
    </div>
  )
}

function exportText(a: DeckAnalysis, missingOnly: boolean, owned: Map<string, number>) {
  const lines: string[] = []
  if (a.deck.commander) lines.push('Commander', `1 ${a.deck.commander.name}`, '', 'Deck')
  for (const dc of a.deck.cards) {
    if (dc.commander) continue
    const n = missingOnly ? (isBasic(dc.card) ? 0 : Math.max(0, dc.qty - (owned.get(dc.card.name) ?? 0))) : dc.qty
    if (n > 0) lines.push(`${n} ${dc.card.name}`)
  }
  return lines.join('\n')
}

function ExportSheet({ open, onClose, a }: { open: boolean; onClose: () => void; a: DeckAnalysis }) {
  const disc = useDiscovery()
  const [missingOnly, setMissingOnly] = useState(false)
  const text = exportText(a, missingOnly, disc.owned)
  return (
    <Sheet open={open} onClose={onClose} title="Export deck">
      <div className="flex gap-2 mb-3">
        <button className="chip" data-on={!missingOnly} onClick={() => setMissingOnly(false)}>
          Full decklist
        </button>
        <button className="chip" data-on={missingOnly} onClick={() => setMissingOnly(true)} disabled={!a.missing.length}>
          Shopping list
        </button>
      </div>
      <textarea readOnly className="input h-64 py-3 font-mono text-xs leading-relaxed" value={text} />
      <p className="text-xs text-fg-3 mt-2">Plain text — works with Arena, Moxfield, Archidekt and most deck tools.</p>
      <div className="flex gap-2 mt-4">
        <button
          className="btn btn-ghost flex-1"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(
              () => toast('Decklist copied'),
              () => toast('Copy failed — select the text instead'),
            )
          }}
        >
          <Copy size={15} /> Copy
        </button>
        <button
          className="btn btn-primary flex-1"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
            const link = document.createElement('a')
            link.href = url
            link.download = `${a.deck.name.replace(/[^\w-]+/g, '_')}${missingOnly ? '_missing' : ''}.txt`
            link.click()
            URL.revokeObjectURL(url)
          }}
        >
          <Download size={15} /> Download .txt
        </button>
      </div>
    </Sheet>
  )
}

function ImproveSheet({ open, onClose, a }: { open: boolean; onClose: () => void; a: DeckAnalysis }) {
  const disc = useDiscovery()
  const nav = useNavigate()
  const prefs = useStore((s) => s.prefs)
  const d = a.deck
  const { adds, cuts } = useMemo(() => {
    if (!open) return { adds: [], cuts: [] }
    const identity = d.commander?.colorIdentity ?? d.colors
    const inDeck = new Set(d.cards.map((c) => c.card.name))
    const keys = d.keyCards.map((n) => d.cards.find((c) => c.card.name === n)?.card).filter(Boolean) as Card[]
    const fmt = d.format === 'casual' ? null : d.format
    const adds = CARDS.filter(
      (c) => !inDeck.has(c.name) && !isLand(c) && !isBasic(c) && (disc.owned.get(c.name) ?? 0) > 0 && c.colorIdentity.every((x) => identity.includes(x)) && (!fmt || c.legalities[fmt] === 'legal'),
    )
      .map((c) => {
        let s = 0
        let why = ''
        for (const k of keys) {
          const l = synergyBetween(k, c)
          if (l && l.score > s) {
            s = l.score
            why = `${l.reason} with ${displayName(k)}`
          }
        }
        return { c, s, why }
      })
      .filter((x) => x.s >= 2)
      .sort((x, y) => y.s - x.s)
      .slice(0, 6)
    const cuts = d.cards
      .filter((dc) => !isLand(dc.card) && !d.keyCards.includes(dc.card.name) && !dc.commander)
      .map((dc) => ({ c: dc.card, s: keys.reduce((acc, k) => acc + (synergyBetween(k, dc.card)?.score ?? 0), 0) + tagsOf(dc.card).length * 0.2 }))
      .sort((x, y) => x.s - y.s)
      .slice(0, 4)
    return { adds, cuts }
  }, [open, d, disc.owned])

  return (
    <Sheet open={open} onClose={onClose} title="Improve with AI" wide>
      <p className="text-sm text-fg-2 mb-5">Swaps that use cards you already own — no spending needed.</p>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-own mb-3">
            <Plus size={14} /> Add from your collection
          </div>
          {adds.length ? (
            <ul className="space-y-2">
              {adds.map(({ c, why }) => (
                <li key={c.id} className="flex items-center gap-3">
                  <CardImage card={c} small className="w-10" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{displayName(c)}</div>
                    <div className="text-xs text-fg-3">{why}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-3">Nothing in your collection beats the current list.</p>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-need mb-3">
            <Minus size={14} /> Weakest links
          </div>
          <ul className="space-y-2">
            {cuts.map(({ c }) => (
              <li key={c.id} className="flex items-center gap-3">
                <CardImage card={c} small className="w-10" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{displayName(c)}</div>
                  <div className="text-xs text-fg-3">Low synergy with {tagLabel(tagsOf(d.cards.find((x) => x.card.name === d.keyCards[0])?.card ?? c)[0] ?? 'the plan').toLowerCase()}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-6 pt-5 border-t hairline flex flex-col sm:flex-row gap-3 items-center">
        <p className="text-sm text-fg-3 flex-1">Or let the builder make a fresh version around the same key card{prefs.budget ? `, within €${prefs.budget}` : ''}.</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            const key = d.commander?.name ?? d.keyCards[0]
            const deck = generateFromPrompt(`${d.commander ? 'Commander deck' : 'Deck'} around ${displayName(CARDS.find((c) => c.name === key)!)} under €${prefs.budget}`, {
              colors: d.commander ? undefined : d.colors,
            })
            onClose()
            nav(`/deck/${deck.id}?new=1`)
          }}
        >
          <RefreshCw size={15} /> Rebuild with AI
        </button>
      </div>
    </Sheet>
  )
}
