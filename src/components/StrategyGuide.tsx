import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Check, Lightbulb, Shuffle, Swords, Users, X } from 'lucide-react'
import type { Guide } from '../lib/guide'
import { displayName } from '../lib/cardDb'
import { CardImage, Pill, cx } from './ui'

type Tab = 'plan' | 'mulligan' | 'tips' | 'matchups' | 'roles'
const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'plan', label: 'Game plan', icon: BookOpen },
  { id: 'mulligan', label: 'Mulligan', icon: Shuffle },
  { id: 'tips', label: 'Play tips', icon: Lightbulb },
  { id: 'matchups', label: 'Matchups', icon: Swords },
  { id: 'roles', label: 'Card roles', icon: Users },
]

export function StrategyGuide({ guide: g }: { guide: Guide }) {
  const [tab, setTab] = useState<Tab>('plan')
  return (
    <section className="panel p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="eyebrow">Strategy guide</div>
        <Pill>{g.style}</Pill>
        <Pill>{g.speed}</Pill>
      </div>
      <p className="text-[17px] leading-relaxed mb-5 max-w-3xl">{g.summary}</p>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 mb-5">
        {TABS.map((t) => (
          <button key={t.id} className="chip h-9" data-on={tab === t.id} onClick={() => setTab(t.id)}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'plan' && (
        <ol className="grid md:grid-cols-3 gap-3">
          {g.plan.map((p, i) => (
            <li key={p.phase} className="rounded-2xl bg-white/[.03] border border-white/5 p-4 flex flex-col">
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-semibold">
                  <span className="display text-2xl text-gold mr-2">{i + 1}</span>
                  {p.phase}
                </span>
                <span className="text-xs text-fg-3">{p.turns}</span>
              </div>
              <p className="text-sm text-fg-2 mb-3 flex-1">{p.text}</p>
              {p.cards.length > 0 && (
                <div className="flex gap-1.5">
                  {p.cards.slice(0, 4).map((c) => (
                    <Link key={c.id} to={`/card/${c.id}`} className="w-11" title={c.name}>
                      <CardImage card={c} small />
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {tab === 'mulligan' && (
        <div className="grid md:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4">
            <div className="flex gap-3">
              <Check size={18} className="text-own shrink-0 mt-0.5" />
              <p className="text-sm">{g.mulligan.keep}</p>
            </div>
            <div className="flex gap-3">
              <X size={18} className="text-need shrink-0 mt-0.5" />
              <p className="text-sm">{g.mulligan.ship}</p>
            </div>
            {g.mulligan.openers.length > 0 && (
              <div>
                <div className="eyebrow mb-2">Best openers</div>
                <div className="flex gap-2">
                  {g.mulligan.openers.map((c) => (
                    <Link key={c.id} to={`/card/${c.id}`} className="w-14" title={c.name}>
                      <CardImage card={c} small />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="eyebrow mb-3">The odds</div>
            <ul className="space-y-3">
              {g.mulligan.odds.map((o) => (
                <li key={o.label}>
                  <div className="flex justify-between text-sm mb-1 gap-3">
                    <span className="text-fg-2">{o.label}</span>
                    <span className="num font-semibold">{o.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[.06] overflow-hidden">
                    <div className="h-full rounded-full bg-gold/80" style={{ width: `${o.pct}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-fg-3 mt-3">Exact hypergeometric odds for this list.</p>
          </div>
        </div>
      )}

      {tab === 'tips' && (
        <ul className="space-y-3 max-w-3xl">
          {g.tips.map((t, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="num text-fg-3 w-5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <span className="text-fg-2">{t}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'matchups' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-own/20 bg-own/[.04] p-4">
            <div className="text-sm font-semibold text-own mb-2">Good against</div>
            <ul className="text-sm text-fg-2 space-y-1.5">
              {g.matchups.good.map((m) => (
                <li key={m}>+ {m}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-need/20 bg-need/[.04] p-4">
            <div className="text-sm font-semibold text-need mb-2">Struggles against</div>
            <ul className="text-sm text-fg-2 space-y-1.5">
              {g.matchups.bad.map((m) => (
                <li key={m}>− {m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <ul className="grid sm:grid-cols-2 gap-3">
          {g.roles.map((r) => (
            <li key={r.card.id}>
              <Link to={`/card/${r.card.id}`} className="flex gap-3 items-center p-2 rounded-xl hover:bg-white/[.03]">
                <CardImage card={r.card} small className="w-12 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{displayName(r.card)}</div>
                  <div className={cx('text-xs font-medium', r.role === 'Commander' ? 'text-gold' : 'text-disc')}>{r.role}</div>
                  <div className="text-xs text-fg-3">{r.why}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
