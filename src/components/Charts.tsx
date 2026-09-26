import { useState } from 'react'
import { cx } from './ui'

/** Mana curve — single series, so one hue; hover reveals exact counts. */
export function ManaCurve({ curve }: { curve: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...curve)
  return (
    <div>
      <div className="flex items-end gap-1.5 h-32" role="img" aria-label={`Mana curve: ${curve.map((n, i) => `${n} at ${i === 7 ? '7+' : i}`).join(', ')}`}>
        {curve.map((n, i) => (
          <div key={i} className="flex-1 h-full flex flex-col justify-end items-center relative group cursor-default" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && (
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-md bg-ink-700 border border-white/10 whitespace-nowrap z-10 num">
                {n} card{n === 1 ? '' : 's'}
              </div>
            )}
            {n > 0 && <span className="num text-[11px] text-fg-3 mb-1">{n}</span>}
            <div className={cx('w-full rounded-t-[4px] transition-all duration-700', hover === i ? 'bg-gold' : 'bg-gold/70')} style={{ height: `${(n / max) * 80}%`, minHeight: n ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2 border-t hairline pt-2">
        {curve.map((_, i) => (
          <div key={i} className="flex-1 text-center text-[11px] text-fg-3 num">
            {i === 7 ? '7+' : i}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TypeBars({ types }: { types: Record<string, number> }) {
  const entries = Object.entries(types).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...entries.map(([, n]) => n))
  return (
    <ul className="space-y-2.5">
      {entries.map(([t, n]) => (
        <li key={t} className="flex items-center gap-3 text-sm" title={`${n} ${t}`}>
          <span className="w-24 text-fg-2 shrink-0">{t}</span>
          <div className="flex-1 h-2 rounded-full bg-white/[.05] overflow-hidden">
            <div className="h-full rounded-full bg-fg-2/60" style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="num text-xs text-fg-3 w-6 text-right">{n}</span>
        </li>
      ))}
    </ul>
  )
}
