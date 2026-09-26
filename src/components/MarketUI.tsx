import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { Part, Potential } from '../lib/market'
import { displayName } from '../lib/cardDb'
import { CardImage, StatusTag, cx, eur } from './ui'

export const PART_LABEL: Record<Part, string> = { demand: 'Demand', supply: 'Supply', catalyst: 'Catalyst', value: 'Value' }

export function ScoreDial({ score, size = 52 }: { score: number; size?: number }) {
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = score >= 60 ? 'var(--color-gold)' : score >= 40 ? 'var(--color-fg-2)' : 'var(--color-fg-3)'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Upside score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(255 255 255 / .08)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center num text-sm font-semibold" style={{ color }}>
        {score}
      </span>
    </div>
  )
}

/** Four signal bars — one hue, the label carries identity. */
export function SignalBars({ p, compact }: { p: Potential; compact?: boolean }) {
  return (
    <div className={cx('grid gap-x-4 gap-y-1.5', compact ? 'grid-cols-4' : 'grid-cols-2')}>
      {(Object.keys(PART_LABEL) as Part[]).map((k) => (
        <div key={k} title={`${PART_LABEL[k]} ${Math.round(p.parts[k] * 100)}/100`}>
          <div className="flex justify-between text-[10px] text-fg-3 mb-0.5">
            <span>{PART_LABEL[k]}</span>
            {!compact && <span className="num">{Math.round(p.parts[k] * 100)}</span>}
          </div>
          <div className="h-1 rounded-full bg-white/[.06] overflow-hidden">
            <div className="h-full rounded-full bg-gold/80" style={{ width: `${p.parts[k] * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

const RISK_STYLE = { Low: 'text-own border-own/25 bg-own/[.07]', Medium: 'text-fg-2 border-white/10 bg-white/[.04]', High: 'text-need border-need/30 bg-need/[.08]' }
export function RiskPill({ risk }: { risk: Potential['risk'] }) {
  return <span className={cx('inline-flex items-center h-6 px-2 rounded-full border text-[11px]', RISK_STYLE[risk])}>{risk} risk</span>
}

export function PotentialRow({ p, rank, owned }: { p: Potential; rank: number; owned: number }) {
  const avoid = p.categories.includes('avoid')
  return (
    <Link to={`/card/${p.card.id}`} className="panel p-3 md:p-4 flex gap-3 md:gap-4 hover:border-white/15 lift group min-w-0">
      <span className="hidden sm:block display text-2xl text-fg-3 w-8 text-center num pt-1">{rank}</span>
      <CardImage card={p.card} small className="w-14 md:w-16 shrink-0 self-start" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate group-hover:text-gold transition-colors">{displayName(p.card)}</div>
            <div className="text-xs text-fg-3 truncate">
              {p.card.setName} · <span className="num text-fg-2">{eur(p.price)}</span>
            </div>
          </div>
          <ScoreDial score={p.score} size={44} />
        </div>
        <p className={cx('text-[13px] mt-1.5 mb-2.5 leading-snug', avoid ? 'text-need' : 'text-fg-2')}>{p.thesis}</p>
        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
          {!avoid && <span className="inline-flex items-center h-6 px-2 rounded-full border border-white/10 text-[11px] text-fg-2">{p.horizon}</span>}
          <RiskPill risk={p.risk} />
          {owned > 0 && <StatusTag kind="own">You own {owned}</StatusTag>}
          {p.momentum != null && (
            <span className={cx('inline-flex items-center gap-0.5 h-6 px-2 rounded-full text-[11px] num', p.momentum >= 0 ? 'text-own' : 'text-need')}>
              {p.momentum >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.round(p.momentum * 100)}%
            </span>
          )}
        </div>
        {!avoid && <SignalBars p={p} compact />}
      </div>
    </Link>
  )
}

/** Price history sparkline; single series, 2px line. */
export function Sparkline({ points, width = 220, height = 48 }: { points: { date: string; eur: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const vals = points.map((p) => p.eur)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const x = (i: number) => (i / (points.length - 1)) * (width - 4) + 2
  const y = (v: number) => height - 4 - ((v - min) / Math.max(0.01, max - min)) * (height - 8)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.eur).toFixed(1)}`).join(' ')
  const up = vals[vals.length - 1] >= vals[0]
  return (
    <svg width={width} height={height} role="img" aria-label={`Price from ${eur(vals[0])} to ${eur(vals[vals.length - 1])}`}>
      <path d={d} fill="none" stroke={up ? 'var(--color-own)' : 'var(--color-need)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.date} cx={x(i)} cy={y(p.eur)} r="6" fill="transparent">
          <title>
            {p.date}: {eur(p.eur)}
          </title>
        </circle>
      ))}
    </svg>
  )
}
