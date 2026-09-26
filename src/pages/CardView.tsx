import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Loader2, Plus, Sparkles, TrendingUp } from 'lucide-react'
import type { Card } from '../lib/types'
import { CARDS, displayName, getCard, isBasic, price } from '../lib/cardDb'
import { COMBOS } from '../data/seed/templates.js'
import { synergyBetween, tagLabel, tagsOf, type SynergyLink } from '../lib/tags'
import { useDiscovery } from '../lib/discovery'
import { useStore } from '../lib/store'
import { FORMAT_LABEL } from '../lib/analysis'
import { AddCardSheet } from './Collection'
import { useMarket, type Market } from '../lib/market'
import { RiskPill, ScoreDial, SignalBars, Sparkline } from '../components/MarketUI'
import { CardImage, DeckTile, Empty, ManaCost, Pill, SectionHeader, StatusTag, cx, eur } from '../components/ui'

type Kind = SynergyLink['kind'] | 'archetype'
const KIND_META: Record<Kind, { label: string; color: string }> = {
  combo: { label: 'Combo', color: '#a78bfa' },
  synergy: { label: 'Synergy', color: '#e7c67f' },
  tribal: { label: 'Tribal', color: '#62c28e' },
  mechanic: { label: 'Mechanic', color: '#6aaee8' },
  strategy: { label: 'Strategy', color: '#b4b2ab' },
  archetype: { label: 'Deck archetype', color: '#eb7a5c' },
}

interface Rel {
  card: Card
  reason: string
  owned: boolean
}

export default function CardView() {
  const { id } = useParams()
  // Market-only cards become resolvable once the market chunk has loaded
  const market = useMarket()
  const card = getCard(id ?? '')
  const disc = useDiscovery()
  const collection = useStore((s) => s.collection)
  const [ownedOnly, setOwnedOnly] = useState(true)
  const [adding, setAdding] = useState(false)
  const nav = useNavigate()

  const rels = useMemo(() => {
    const out: Record<Kind, Rel[]> = { combo: [], synergy: [], tribal: [], mechanic: [], strategy: [], archetype: [] }
    if (!card) return out
    for (const cb of COMBOS) {
      if (!cb.cards.includes(card.name)) continue
      for (const n of cb.cards)
        if (n !== card.name) {
          const other = CARDS.find((c) => c.name === n)
          if (other) out.combo.push({ card: other, reason: cb.result, owned: (disc.owned.get(n) ?? 0) > 0 })
        }
    }
    const scored: { c: Card; l: SynergyLink }[] = []
    for (const c of CARDS) {
      if (c.id === card.id || isBasic(c)) continue
      const owned = (disc.owned.get(c.name) ?? 0) > 0
      if (ownedOnly && !owned) continue
      const l = synergyBetween(card, c)
      if (l) scored.push({ c, l })
    }
    scored.sort((a, b) => b.l.score - a.l.score || (a.c.edhrecRank ?? 1e6) - (b.c.edhrecRank ?? 1e6))
    for (const { c, l } of scored) {
      const bucket = out[l.kind]
      if (bucket.length < 6) bucket.push({ card: c, reason: l.reason, owned: (disc.owned.get(c.name) ?? 0) > 0 })
    }
    // Cards that share decks with this one
    const decks = disc.all.filter((a) => a.deck.cards.some((dc) => dc.card.id === card.id))
    const seen = new Set<string>()
    for (const a of decks)
      for (const n of a.deck.keyCards) {
        const c = a.deck.cards.find((dc) => dc.card.name === n)?.card
        if (!c || c.id === card.id || seen.has(c.name)) continue
        seen.add(c.name)
        out.archetype.push({ card: c, reason: a.deck.name, owned: (disc.owned.get(c.name) ?? 0) > 0 })
      }
    out.archetype = out.archetype.slice(0, 6)
    return out
  }, [card, disc, ownedOnly])

  if (!card && !market) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gold" /></div>
  if (!card) return <Empty icon={<Sparkles size={22} />} title="Card not found" text="This card isn't in the database." />

  const ownedQty = collection.filter((e) => getCard(e.cardId)?.name === card.name).reduce((a, e) => a + e.qty, 0)
  const inDecks = disc.all.filter((a) => a.deck.cards.some((dc) => dc.card.id === card.id))
  const kinds = (Object.keys(rels) as Kind[]).filter((k) => rels[k].length)
  const tags = tagsOf(card)
  const faces = card.oracleText.split('\n//\n')

  return (
    <div className="space-y-10">
      <button onClick={() => nav(-1)} className="inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg">
        <ArrowLeft size={15} /> Back
      </button>

      <section className="grid md:grid-cols-[minmax(0,340px)_1fr] gap-8 items-start">
        <div className="relative max-w-[340px] mx-auto w-full">
          <div className="absolute -inset-10 rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, rgb(231 198 127 / .25), transparent 70%)' }} />
          <CardImage card={card} className="relative shadow-2xl shadow-black/70" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {ownedQty > 0 ? <StatusTag kind="own">You own {ownedQty}</StatusTag> : <StatusTag kind="need">Not in your collection</StatusTag>}
            {card.isNew && <StatusTag kind="disc">New card</StatusTag>}
            <Pill className="capitalize">{card.rarity}</Pill>
          </div>
          <h1 className="display text-5xl md:text-6xl mb-3">{displayName(card)}</h1>
          <div className="flex items-center gap-3 mb-5 text-fg-2">
            <ManaCost cost={card.manaCost} size={18} />
            <span>{card.typeLine}</span>
          </div>
          <div className="panel p-5 mb-5 space-y-3 text-[15px] leading-relaxed">
            {faces.map((f, i) => (
              <p key={i} className="whitespace-pre-line">
                {f}
              </p>
            ))}
            {card.power && (
              <div className="num text-fg-2">
                {card.power}/{card.toughness}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Info label="Price" value={eur(price(card))} sub={card.prices.estimated ? 'estimated' : 'trend'} />
            <Info label="Foil" value={card.prices.eurFoil ? eur(card.prices.eurFoil) : '—'} />
            <Info label="Set" value={card.set.toUpperCase()} sub={card.setName} />
            <Info label="Number" value={`#${card.collectorNumber}`} />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {(['standard', 'pioneer', 'modern', 'legacy', 'pauper', 'commander'] as const).map((f) => (
              <span key={f} className={cx('h-7 px-2.5 rounded-full text-xs inline-flex items-center border', card.legalities[f] === 'legal' ? 'border-own/25 text-own bg-own/[.06]' : 'border-white/5 text-fg-3 line-through decoration-white/20')}>
                {FORMAT_LABEL[f]}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-6">
            {tags.slice(0, 8).map((t) => (
              <Pill key={t}>{tagLabel(t)}</Pill>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add to collection
          </button>
        </div>
      </section>

      <PriceOutlook card={card} market={market} />

      {/* Synergy explorer */}
      <section>
        <SectionHeader
          eyebrow="Synergy explorer"
          title="What works with this?"
          action={
            <div className="flex rounded-full border border-white/10 p-1 text-sm">
              <button className={cx('px-3 h-8 rounded-full', ownedOnly && 'bg-white/10')} onClick={() => setOwnedOnly(true)}>
                I own
              </button>
              <button className={cx('px-3 h-8 rounded-full', !ownedOnly && 'bg-white/10')} onClick={() => setOwnedOnly(false)}>
                All cards
              </button>
            </div>
          }
        />
        {kinds.length ? (
          <div className="grid xl:grid-cols-[minmax(0,640px)_1fr] gap-6 items-start">
            <SynergyGraph center={card} rels={rels} kinds={kinds} />
            <div className="space-y-5">
              {kinds.map((k) => (
                <div key={k}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: KIND_META[k].color }} />
                    <span className="text-sm font-semibold">{KIND_META[k].label}</span>
                    <span className="text-xs text-fg-3 num">{rels[k].length}</span>
                  </div>
                  <ul className="grid sm:grid-cols-2 gap-2">
                    {rels[k].map((r) => (
                      <li key={r.card.id}>
                        <Link to={`/card/${r.card.id}`} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[.04]">
                          <CardImage card={r.card} small className="w-9 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{displayName(r.card)}</div>
                            <div className="text-xs text-fg-3 truncate">{r.reason}</div>
                          </div>
                          {r.owned ? <StatusTag kind="own" className="px-1.5">{''}</StatusTag> : <StatusTag kind="disc" className="px-1.5">{''}</StatusTag>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="panel p-8 text-center text-fg-3">No strong interactions found{ownedOnly ? ' in your collection — try “All cards”.' : '.'}</div>
        )}
      </section>

      {inDecks.length > 0 && (
        <section>
          <SectionHeader eyebrow="Plays in" title={`${inDecks.length} deck${inDecks.length > 1 ? 's' : ''} use this card`} />
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {inDecks.slice(0, 6).map((a) => (
              <DeckTile key={a.deck.id} a={a} />
            ))}
          </div>
        </section>
      )}

      <AddCardSheet key={card.id} open={adding} onClose={() => setAdding(false)} initial={card} />
    </div>
  )
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel px-4 py-3 rounded-2xl">
      <div className="text-[11px] text-fg-3 uppercase tracking-wider">{label}</div>
      <div className="num font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-fg-3 truncate">{sub}</div>}
    </div>
  )
}

function SynergyGraph({ center, rels, kinds }: { center: Card; rels: Record<Kind, Rel[]>; kinds: Kind[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const n = kinds.length
  const nodes = kinds.flatMap((k, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    const items = rels[k].slice(0, 3)
    return [
      { type: 'hub' as const, k, x: 50 + Math.cos(angle) * 22, y: 50 + Math.sin(angle) * 22, angle },
      ...items.map((r, j) => {
        const spread = (j - (items.length - 1) / 2) * (0.62 / Math.max(1, n / 4))
        const a = angle + spread
        return { type: 'card' as const, k, r, x: 50 + Math.cos(a) * 39, y: 50 + Math.sin(a) * 39, hubAngle: angle }
      }),
    ]
  })
  const hubs = nodes.filter((x) => x.type === 'hub')
  return (
    <div className="panel relative aspect-square w-full overflow-hidden" style={{ background: 'radial-gradient(circle at 50% 50%, rgb(231 198 127 / .06), transparent 60%), var(--color-ink-850)' }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
        {[22, 39].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / .04)" strokeWidth=".3" strokeDasharray="1 1" />
        ))}
        {nodes.map((nd, i) => {
          const hub = hubs.find((h) => h.k === nd.k)!
          const from = nd.type === 'hub' ? { x: 50, y: 50 } : hub
          const active = !hover || hover === nd.k
          return <line key={i} x1={from.x} y1={from.y} x2={nd.x} y2={nd.y} stroke={KIND_META[nd.k].color} strokeOpacity={active ? 0.45 : 0.08} strokeWidth={nd.type === 'hub' ? 0.45 : 0.3} style={{ transition: 'stroke-opacity .3s' }} />
        })}
      </svg>
      {/* center */}
      <div className="absolute w-[20%] -translate-x-1/2 -translate-y-1/2 z-10" style={{ left: '50%', top: '50%' }}>
        <CardImage card={center} small className="shadow-2xl shadow-black ring-2 ring-gold/50" />
      </div>
      {nodes.map((nd, i) =>
        nd.type === 'hub' ? (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 text-[10px] md:text-[11px] font-medium px-2 py-1 rounded-full border bg-ink-850 whitespace-nowrap cursor-default"
            style={{ left: `${nd.x}%`, top: `${nd.y}%`, borderColor: KIND_META[nd.k].color + '66', color: KIND_META[nd.k].color }}
            onMouseEnter={() => setHover(nd.k)}
            onMouseLeave={() => setHover(null)}
          >
            {KIND_META[nd.k].label}
          </div>
        ) : (
          <Link
            key={i}
            to={`/card/${nd.r.card.id}`}
            title={`${nd.r.card.name} — ${nd.r.reason}`}
            className="absolute w-[12.5%] -translate-x-1/2 -translate-y-1/2 z-10 transition-transform duration-300 hover:scale-125 hover:z-20"
            style={{ left: `${nd.x}%`, top: `${nd.y}%`, opacity: !hover || hover === nd.k ? 1 : 0.35 }}
            onMouseEnter={() => setHover(nd.k)}
            onMouseLeave={() => setHover(null)}
          >
            <CardImage card={nd.r.card} small className={cx('shadow-lg shadow-black/60', !nd.r.owned && 'ring-1 ring-disc/70')} />
          </Link>
        ),
      )}
    </div>
  )
}

function PriceOutlook({ card, market }: { card: Card; market: Market | null }) {
  const p = market?.byOracle.get(card.oracleId)
  return (
    <section className="panel p-5 md:p-7">
      <div className="flex items-center justify-between gap-4 mb-5">
        <div>
          <div className="eyebrow mb-1 flex items-center gap-1.5">
            <TrendingUp size={12} /> Price outlook
          </div>
          <h2 className="text-lg font-semibold">{p ? p.thesis.split(' · ')[0] : 'Upside analysis'}</h2>
        </div>
        {p && <ScoreDial score={p.score} size={60} />}
      </div>
      {!market ? (
        <div className="text-sm text-fg-3 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Reading the market…
        </div>
      ) : !p ? (
        <p className="text-sm text-fg-3">Not among the ~1,400 most-played Commander cards we track, so there's no upside score for it.</p>
      ) : (
        <div className="grid md:grid-cols-[1fr_260px] gap-6">
          <div>
            <ul className="space-y-2 mb-5">
              {p.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  {r.tone === 'up' ? <ArrowUpRight size={16} className="text-own shrink-0 mt-0.5" /> : <ArrowDownRight size={16} className="text-need shrink-0 mt-0.5" />}
                  <span className={r.tone === 'down' ? 'text-need' : 'text-fg-2'}>{r.text}</span>
                </li>
              ))}
            </ul>
            {p.catalysts.length > 0 && (
              <>
                <div className="eyebrow mb-2">Commanders that want it</div>
                <div className="flex gap-2 flex-wrap">
                  {p.catalysts.map((c) => (
                    <Link key={c.commander.id} to={`/card/${c.commander.id}`} className="w-14" title={`${c.commander.name} — ${c.reason}`}>
                      <CardImage card={c.commander} small />
                      <div className={cx('text-[10px] mt-1 truncate', c.upcoming ? 'text-disc' : 'text-fg-3')}>{c.upcoming ? 'Upcoming' : c.setName}</div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="space-y-4">
            <SignalBars p={p} />
            <div className="flex flex-wrap gap-1.5">
              <RiskPill risk={p.risk} />
              {!p.categories.includes('avoid') && <Pill>{p.horizon}</Pill>}
              <Pill>{p.signal.reserved ? 'Reserved List' : p.signal.prints >= 5 ? '5+ printings' : p.signal.prints === 4 ? '3–4 printings' : `${p.signal.prints} printing${p.signal.prints > 1 ? 's' : ''}`}</Pill>
            </div>
            <div className="text-xs text-fg-3 space-y-1">
              <div className="flex justify-between">
                <span>EU price</span>
                <span className="num text-fg-2">{eur(p.price)}</span>
              </div>
              {p.signal.usd != null && (
                <div className="flex justify-between">
                  <span>US price</span>
                  <span className="num text-fg-2">${p.signal.usd.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Last printed</span>
                <span className="num text-fg-2">{p.signal.lastPrinted}</span>
              </div>
            </div>
            {p.history.length >= 2 ? (
              <div>
                <div className="flex justify-between text-[11px] text-fg-3 mb-1">
                  <span>{p.history[0].date}</span>
                  <span>{p.history[p.history.length - 1].date}</span>
                </div>
                <Sparkline points={p.history} width={240} />
              </div>
            ) : (
              <p className="text-xs text-fg-3">No Cardmarket trend data for this card yet.</p>
            )}
            {p.signal.cmUrl && (
              <a href={p.signal.cmUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm w-full">
                View on Cardmarket{p.signal.cm?.low ? ` · from ${eur(p.signal.cm.low)}` : ''}
              </a>
            )}
            <p className="text-[11px] text-fg-3">Estimate from public data — not financial advice.</p>
          </div>
        </div>
      )}
    </section>
  )
}
