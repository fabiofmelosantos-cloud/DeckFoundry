import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, Check, GitCompare, Swords } from 'lucide-react'
import type { DeckAnalysis } from '../lib/types'
import { useDiscovery } from '../lib/discovery'
import { cardsAway, FORMAT_LABEL } from '../lib/analysis'
import { isLand } from '../lib/cardDb'
import { tagsOf } from '../lib/tags'
import { DeckTile, Empty, ManaPips, PageHeader, PowerBadge, cx, eur } from '../components/ui'

type Tab = 'saved' | 'ready' | 'all' | 'compare'

export default function Decks() {
  const disc = useDiscovery()
  const [tab, setTab] = useState<Tab>(disc.saved.length ? 'saved' : 'ready')
  const [picked, setPicked] = useState<string[]>([])

  const list = tab === 'saved' ? disc.saved : tab === 'ready' ? disc.all.filter((a) => a.pct >= 90) : disc.all
  const tabs: [Tab, string, number][] = [
    ['saved', 'Saved', disc.saved.length],
    ['ready', 'Ready to build', disc.all.filter((a) => a.pct >= 90).length],
    ['all', 'All discovered', disc.all.length],
    ['compare', 'Compare', picked.length],
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Decks"
        title="Your decks"
        subtitle="Saved lists, everything your collection can build, and side-by-side comparisons."
        action={
          <Link to="/play" className="btn btn-primary">
            <Swords size={16} /> Play with friends
          </Link>
        }
      />
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 mb-6">
        {tabs.map(([id, label, n]) => (
          <button key={id} className="chip h-10 px-4" data-on={tab === id} onClick={() => setTab(id)}>
            {id === 'compare' && <GitCompare size={14} />}
            {label} <span className="num text-xs opacity-60">{n}</span>
          </button>
        ))}
      </div>

      {tab === 'compare' ? (
        <Compare picked={picked} setPicked={setPicked} all={disc.all} />
      ) : list.length ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((a) => (
            <DeckTile key={a.deck.id} a={a} />
          ))}
        </div>
      ) : (
        <Empty icon={<Bookmark size={22} />} title="No saved decks yet" text="Save any deck from its page to keep it here." action={<Link to="/discover" className="btn btn-primary">Discover decks</Link>} />
      )}
    </div>
  )
}

function Compare({ picked, setPicked, all }: { picked: string[]; setPicked: (p: string[]) => void; all: DeckAnalysis[] }) {
  const chosen = picked.map((id) => all.find((a) => a.deck.id === id)!).filter(Boolean)
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < 3 ? [...picked, id] : [...picked.slice(1), id])
  const rows = useMemo(() => {
    const count = (a: DeckAnalysis, tags: string[]) => a.deck.cards.filter((c) => !isLand(c.card) && tagsOf(c.card).some((t) => tags.includes(t))).reduce((s, c) => s + c.qty, 0)
    const avg = (a: DeckAnalysis) => {
      const n = a.curve.reduce((x, y) => x + y, 0)
      return a.curve.reduce((s, v, i) => s + v * i, 0) / Math.max(1, n)
    }
    return [
      { label: 'Ready', get: (a: DeckAnalysis) => a.pct, fmt: (v: number) => `${v}%`, best: 'max' },
      { label: 'Cards missing', get: cardsAway, fmt: String, best: 'min' },
      { label: 'Cost to complete', get: (a: DeckAnalysis) => a.costToComplete, fmt: (v: number) => eur(v), best: 'min' },
      { label: 'Deck value', get: (a: DeckAnalysis) => a.deckValue, fmt: (v: number) => eur(v, 0), best: '' },
      { label: 'Avg mana value', get: avg, fmt: (v: number) => v.toFixed(2), best: 'min' },
      { label: 'Interaction', get: (a: DeckAnalysis) => count(a, ['removal', 'counterspell', 'wipe']), fmt: String, best: 'max' },
      { label: 'Card draw', get: (a: DeckAnalysis) => count(a, ['draw']), fmt: String, best: 'max' },
      { label: 'Combos', get: (a: DeckAnalysis) => a.combos.length, fmt: String, best: 'max' },
    ] as const
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow mb-3">Pick up to 3 decks</div>
        <div className="flex flex-wrap gap-2">
          {all.map((a) => (
            <button key={a.deck.id} className="chip" data-on={picked.includes(a.deck.id)} onClick={() => toggle(a.deck.id)}>
              {picked.includes(a.deck.id) && <Check size={13} />}
              <ManaPips colors={a.deck.colors} size={12} />
              {a.deck.name}
            </button>
          ))}
        </div>
      </div>
      {chosen.length >= 2 ? (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b hairline">
                <th className="text-left p-4 font-normal text-fg-3 w-40" />
                {chosen.map((a) => (
                  <th key={a.deck.id} className="text-left p-4 align-top">
                    <Link to={`/deck/${a.deck.id}`} className="hover:text-gold">
                      <ManaPips colors={a.deck.colors} size={14} />
                      <div className="font-semibold mt-1.5">{a.deck.name}</div>
                    </Link>
                    <div className="flex gap-1.5 mt-2 font-normal">
                      <PowerBadge power={a.deck.power} />
                    </div>
                    <div className="text-xs text-fg-3 font-normal mt-1">{a.deck.format === 'casual' ? 'Casual' : FORMAT_LABEL[a.deck.format]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vals = chosen.map((a) => r.get(a))
                const bestV = r.best === 'max' ? Math.max(...vals) : r.best === 'min' ? Math.min(...vals) : null
                return (
                  <tr key={r.label} className="border-b hairline last:border-0">
                    <td className="p-4 text-fg-3">{r.label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={cx('p-4 num', bestV === v && vals.filter((x) => x === v).length < vals.length && 'text-own font-semibold')}>
                        {r.fmt(v)}
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr>
                <td className="p-4 text-fg-3 align-top">Mana curve</td>
                {chosen.map((a) => {
                  const max = Math.max(1, ...a.curve)
                  return (
                    <td key={a.deck.id} className="p-4">
                      <div className="flex items-end gap-1 h-12">
                        {a.curve.map((n, i) => (
                          <div key={i} title={`${n} at ${i === 7 ? '7+' : i}`} className="flex-1 bg-gold/70 rounded-t-[3px]" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0 }} />
                        ))}
                      </div>
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel p-10 text-center text-fg-3">Select at least two decks to compare them side by side.</div>
      )}
    </div>
  )
}
