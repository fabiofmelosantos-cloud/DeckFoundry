import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Crown, Globe2, Gem, Loader2, Sparkles, TrendingUp, Wallet, Layers } from 'lucide-react'
import { useMarket, type Category, type Potential } from '../lib/market'
import { useOwned } from '../lib/store'
import { displayName } from '../lib/cardDb'
import { PotentialRow } from '../components/MarketUI'
import { CardImage, PageHeader, cx, eur } from '../components/ui'

type Tab = 'top' | Category | 'hold'
const TABS: { id: Tab; label: string; icon: typeof TrendingUp; blurb: string }[] = [
  { id: 'top', label: 'Top picks', icon: TrendingUp, blurb: 'The strongest combination of demand, supply, new strategies and price — excluding announced reprints.' },
  { id: 'catalyst', label: 'New commanders', icon: Crown, blurb: 'Older cards that new and upcoming commanders want. Demand usually jumps around release.' },
  { id: 'undervalued', label: 'Undervalued', icon: Wallet, blurb: 'Played far more than their price suggests.' },
  { id: 'supply', label: 'Low supply', icon: Gem, blurb: 'Few printings, long gaps since the last one, or the Reserved List.' },
  { id: 'gap', label: 'EU/US gap', icon: Globe2, blurb: 'The US price is well above the usual gap. European prices often catch up.' },
  { id: 'hold', label: 'Hold yours', icon: Layers, blurb: 'Cards you already own with upside — think twice before trading them away.' },
  { id: 'avoid', label: 'Reprint risk', icon: AlertTriangle, blurb: 'Reprints announced in upcoming sets. Prices usually drop on release — wait, or sell now.' },
]
const PRICE_STEPS = [2, 5, 10, 20, 50, 100, Infinity]

export default function Market() {
  const market = useMarket()
  const owned = useOwned()
  const [tab, setTab] = useState<Tab>('top')
  const [maxIdx, setMaxIdx] = useState(PRICE_STEPS.length - 1)
  const [hideOwned, setHideOwned] = useState(false)
  const [limit, setLimit] = useState(25)
  const maxPrice = PRICE_STEPS[maxIdx]

  const list = useMemo(() => {
    if (!market) return []
    const own = (p: Potential) => owned.get(p.card.name) ?? 0
    let l = market.potentials
    if (tab === 'top') l = l.filter((p) => !p.categories.includes('avoid') && p.price >= 0.5)
    else if (tab === 'hold') l = l.filter((p) => own(p) > 0 && !p.categories.includes('avoid'))
    else if (tab === 'avoid') l = [...l.filter((p) => p.categories.includes('avoid'))].sort((a, b) => b.price - a.price)
    else l = l.filter((p) => p.categories.includes(tab))
    return l.filter((p) => p.price <= maxPrice && (tab === 'hold' || !hideOwned || own(p) === 0))
  }, [market, tab, maxPrice, hideOwned, owned])

  const current = TABS.find((t) => t.id === tab)!

  return (
    <div>
      <PageHeader
        eyebrow="Buy potential"
        title={
          <>
            Cards with <span className="italic text-gold">upside</span>
          </>
        }
        subtitle="DeckFoundry reads what's changing in the game — new commanders, the themes new sets push, announced reprints — and weighs it against demand, supply and price."
      />

      {!market ? (
        <div className="panel p-12 flex flex-col items-center text-center">
          <Loader2 className="animate-spin text-gold mb-3" />
          <div className="font-medium">Reading the market…</div>
          <div className="text-sm text-fg-3">Scoring the most-played Commander cards</div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* What we're reading */}
          <section className="grid lg:grid-cols-3 gap-4">
            <div className="panel p-5 lg:col-span-2 min-w-0">
              <div className="eyebrow mb-1">Strategies we're reading</div>
              <h2 className="font-semibold mb-4">
                {market.strategies.commanders.length} new & upcoming commanders
              </h2>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {market.strategies.commanders
                  .filter((k) => k.upcoming)
                  .concat(market.strategies.commanders.filter((k) => !k.upcoming))
                  .slice(0, 14)
                  .map((k) => (
                    <Link key={k.card.id} to={`/card/${k.card.id}`} className="w-16 shrink-0 group" title={`${k.card.name} — ${k.setName}`}>
                      <CardImage card={k.card} small className="group-hover:-translate-y-1 transition-transform" />
                      <div className={cx('text-[10px] mt-1 truncate', k.upcoming ? 'text-disc' : 'text-fg-3')}>{k.upcoming ? 'Upcoming' : k.setName}</div>
                    </Link>
                  ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-4 items-center">
                <span className="text-xs text-fg-3 mr-1">Themes being pushed:</span>
                {market.strategies.themes.map((t) => (
                  <span key={t.tag} className="chip h-7 text-xs">
                    <Sparkles size={11} className="text-disc" />
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="panel p-5 flex flex-col min-w-0">
              <div className="eyebrow mb-3">Market snapshot</div>
              <dl className="grid grid-cols-2 gap-y-3 text-sm mb-4">
                <dt className="text-fg-3">Cards scored</dt>
                <dd className="num text-right">{market.potentials.length.toLocaleString('en-IE')}</dd>
                <dt className="text-fg-3">Prices from</dt>
                <dd className="num text-right">{market.generatedAt}</dd>
                <dt className="text-fg-3">Announced reprints</dt>
                <dd className="num text-right text-need">{market.potentials.filter((p) => p.categories.includes('avoid')).length}</dd>
                <dt className="text-fg-3">Price trends</dt>
                <dd className="text-right">Cardmarket, 30 days</dd>
              </dl>
              <p className="text-xs text-fg-3 mt-auto leading-relaxed break-words">
                Estimates from public data — not financial advice. Card prices can fall.
              </p>
            </div>
          </section>

          {/* Tabs + filters */}
          <section>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className="chip h-10 px-3.5"
                  data-on={tab === t.id}
                  onClick={() => {
                    setTab(t.id)
                    setLimit(25)
                  }}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 mt-4 mb-5">
              <p className="text-sm text-fg-2 max-w-xl">{current.blurb}</p>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-fg-3">
                  Up to
                  <input type="range" min={0} max={PRICE_STEPS.length - 1} value={maxIdx} onChange={(e) => setMaxIdx(+e.target.value)} className="w-24 accent-[#e7c67f]" aria-label="Maximum price" />
                  <span className="num text-fg w-12">{maxPrice === Infinity ? 'Any' : eur(maxPrice, 0)}</span>
                </label>
                {tab !== 'hold' && (
                  <button className="chip" data-on={hideOwned} onClick={() => setHideOwned(!hideOwned)}>
                    Hide cards I own
                  </button>
                )}
              </div>
            </div>

            <div className="grid xl:grid-cols-[1fr_300px] gap-6 items-start">
              <div className="space-y-2 min-w-0">
                {list.slice(0, limit).map((p, i) => (
                  <PotentialRow key={p.card.oracleId} p={p} rank={i + 1} owned={owned.get(p.card.name) ?? 0} />
                ))}
                {list.length === 0 && <div className="panel p-10 text-center text-fg-3">Nothing matches — try a higher price limit.</div>}
                {list.length > limit && (
                  <div className="flex justify-center pt-4">
                    <button className="btn btn-ghost" onClick={() => setLimit((l) => l + 25)}>
                      Show more ({list.length - limit})
                    </button>
                  </div>
                )}
              </div>
              <aside className="panel p-5 xl:sticky xl:top-6 text-sm">
                <div className="eyebrow mb-3">How the score works</div>
                <ul className="space-y-3 text-fg-2">
                  <li>
                    <b className="text-fg">Demand · 30</b> — how much the card is played in Commander, and whether it's core to an established archetype.
                  </li>
                  <li>
                    <b className="text-fg">Supply · 25</b> — number of printings, years since the last one, Reserved List.
                  </li>
                  <li>
                    <b className="text-fg">Catalyst · 25</b> — new or upcoming commanders that specifically want it, and themes the newest sets push.
                  </li>
                  <li>
                    <b className="text-fg">Value · 20</b> — cheap for its demand, the EU price lagging the US, or a recent reprint dip.
                  </li>
                  <li className="text-need">
                    <b>Penalties</b> — announced reprints, frequent reprints at high prices, bulk prices.
                  </li>
                </ul>
                <p className="text-xs text-fg-3 mt-4">Estimates only, never a guarantee.</p>
                {tab === 'catalyst' && list[0]?.catalysts[0] && (
                  <p className="text-xs text-fg-3 mt-3">
                    Example: {displayName(list[0].card)} ← {list[0].catalysts.map((c) => displayName(c.commander).split(',')[0]).join(', ')}.
                  </p>
                )}
              </aside>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
