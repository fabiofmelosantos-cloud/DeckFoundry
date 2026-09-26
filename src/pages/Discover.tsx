import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Crown, Dices, FlaskConical, Swords, Users, Layers } from 'lucide-react'
import type { DeckAnalysis } from '../lib/types'
import { useDiscovery } from '../lib/discovery'
import { generateExperiment } from '../lib/generate'
import { BuildPanel } from '../components/BuildPanel'
import { DeckTile, Empty, OwnershipLegend, PageHeader, cx } from '../components/ui'

type Tab = 'all' | 'meta' | 'kitchen' | 'lab' | 'commander'
const TABS: { id: Tab; label: string; icon: typeof Swords; blurb: string }[] = [
  { id: 'all', label: 'For you', icon: Layers, blurb: 'Everything your collection can build, ranked by how close you are and what you like to play.' },
  { id: 'meta', label: 'Meta', icon: Swords, blurb: 'Competitive lists you can sleeve up with the cards you already have.' },
  { id: 'kitchen', label: 'Kitchen Table', icon: Users, blurb: 'Fun, balanced decks for playing with friends.' },
  { id: 'lab', label: 'Lab', icon: FlaskConical, blurb: 'Unexpected combinations and original decks nobody else is playing.' },
  { id: 'commander', label: 'Commander', icon: Crown, blurb: 'Legendary creatures you own, each with a 100-card deck built around them.' },
]
type SortKey = 'ready' | 'cost' | 'value'

export default function Discover() {
  const disc = useDiscovery()
  const nav = useNavigate()
  const { hash } = useLocation()
  const [tab, setTab] = useState<Tab>('all')
  const [sort, setSort] = useState<SortKey>('ready')
  const [readyOnly, setReadyOnly] = useState(false)

  useEffect(() => {
    if (hash === '#build') setTimeout(() => document.getElementById('build')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [hash])

  const list = useMemo(() => {
    let l: DeckAnalysis[] = tab === 'all' ? disc.all.filter((a) => a.deck.mode !== 'lab') : tab === 'lab' ? disc.lab : disc.all.filter((a) => a.deck.mode === tab)
    if (readyOnly) l = l.filter((a) => a.pct === 100)
    const by: Record<SortKey, (a: DeckAnalysis, b: DeckAnalysis) => number> = {
      ready: () => 0,
      cost: (a, b) => a.costToComplete - b.costToComplete,
      value: (a, b) => b.deckValue - a.deckValue,
    }
    return sort === 'ready' ? (tab === 'all' ? l : [...l].sort((a, b) => b.pct - a.pct)) : [...l].sort(by[sort])
  }, [disc, tab, sort, readyOnly])

  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Discover" title={<>Discover your <span className="italic text-gold">collection</span></>} subtitle="Find decks you didn't know you could build." />

      {/* Surprise me */}
      <button
        onClick={() => nav(`/deck/${generateExperiment(true).id}?new=1`)}
        className="w-full text-left relative overflow-hidden rounded-[24px] p-6 md:p-8 border border-disc/25 group lift"
        style={{ background: 'radial-gradient(600px 240px at 90% 0%, rgb(167 139 250 / .22), transparent 70%), radial-gradient(500px 200px at 0% 100%, rgb(231 198 127 / .12), transparent 70%), #111317' }}
      >
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-disc/15 border border-disc/30 flex items-center justify-center text-disc shrink-0 group-hover:rotate-12 transition-transform duration-500">
            <Dices size={34} />
          </div>
          <div>
            <div className="text-2xl md:text-3xl font-semibold tracking-tight">Surprise me</div>
            <div className="text-fg-2">Build something I would never have thought of.</div>
          </div>
        </div>
      </button>

      {/* Modes */}
      <div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cx('chip h-11 px-4 text-sm', tab === t.id && 'text-fg')} data-on={tab === t.id}>
              <t.icon size={16} />
              {t.label}
              <span className="num text-xs opacity-60">{t.id === 'all' ? disc.all.filter((a) => a.deck.mode !== 'lab').length : t.id === 'lab' ? disc.lab.length : disc.all.filter((a) => a.deck.mode === t.id).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 mb-5">
          <p className="text-fg-2 text-sm max-w-xl">{current.blurb}</p>
          <div className="flex items-center gap-2">
            <button className="chip" data-on={readyOnly} onClick={() => setReadyOnly(!readyOnly)}>
              100% ready
            </button>
            <select className="chip bg-transparent outline-none cursor-pointer" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
              <option value="ready">Best match</option>
              <option value="cost">Cheapest to finish</option>
              <option value="value">Deck value</option>
            </select>
          </div>
        </div>
        <div className="mb-5">
          <OwnershipLegend />
        </div>

        {list.length ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {list.map((a, i) => (
              <div key={a.deck.id} className="rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <DeckTile a={a} />
              </div>
            ))}
          </div>
        ) : tab === 'lab' ? (
          <Empty
            icon={<FlaskConical size={22} />}
            title="No experiments yet"
            text="The Lab mixes themes and colours you'd never pair on purpose — using what you own."
            action={
              <button className="btn btn-primary" onClick={() => nav(`/deck/${generateExperiment().id}?new=1`)}>
                Run first experiment
              </button>
            }
          />
        ) : (
          <div className="text-fg-3 text-center py-12">Nothing here with the current filters.</div>
        )}
      </div>

      <BuildPanel />
    </div>
  )
}
