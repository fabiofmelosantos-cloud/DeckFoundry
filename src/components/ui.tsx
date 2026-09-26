import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, ShoppingBag, Sparkles, X } from 'lucide-react'
import type { Card, Color, DeckAnalysis, Power } from '../lib/types'
import { displayName } from '../lib/cardDb'
import { FORMAT_LABEL, guildName } from '../lib/analysis'
import { cardsAway } from '../lib/analysis'

export const eur = (n: number, digits = 2) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
export const int = (n: number) => new Intl.NumberFormat('en-IE').format(n)

export const cx = (...c: (string | false | null | undefined | 0)[]) => c.filter(Boolean).join(' ')

// ---- Mana ------------------------------------------------------------------
const MANA_BG: Record<string, string> = {
  W: 'radial-gradient(circle at 35% 30%, #fffbea, #e6d9ad)',
  U: 'radial-gradient(circle at 35% 30%, #a9d4fa, #3f86c8)',
  B: 'radial-gradient(circle at 35% 30%, #cbbfd8, #6b5c7c)',
  R: 'radial-gradient(circle at 35% 30%, #ffb59e, #cf5836)',
  G: 'radial-gradient(circle at 35% 30%, #a6e7c1, #33915e)',
  C: 'radial-gradient(circle at 35% 30%, #e7e4dc, #8f8c84)',
}
const MANA_FG: Record<string, string> = { W: '#3d3418', U: '#082843', B: '#1e1527', R: '#3f1206', G: '#07301a', C: '#2a2926' }

export function Pip({ c, size = 16, label }: { c: string; size?: number; label?: string }) {
  const key = MANA_BG[c] ? c : 'C'
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold shrink-0"
      style={{ width: size, height: size, background: MANA_BG[key], color: MANA_FG[key], fontSize: size * 0.56, boxShadow: '0 1px 0 rgb(255 255 255 / .25) inset, 0 1px 2px rgb(0 0 0 / .4)' }}
      aria-label={label ?? c}
    >
      {label ?? (MANA_BG[c] ? '' : c)}
    </span>
  )
}

export function ManaPips({ colors, size = 16 }: { colors: Color[]; size?: number }) {
  if (!colors.length) return <Pip c="C" size={size} />
  return (
    <span className="inline-flex items-center gap-1" aria-label={guildName(colors)}>
      {colors.map((c) => (
        <Pip key={c} c={c} size={size} />
      ))}
    </span>
  )
}

export function ManaCost({ cost, size = 15 }: { cost: string; size?: number }) {
  const parts = cost.split(' // ')[0].match(/\{[^}]+\}/g) ?? []
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((p, i) => {
        const s = p.slice(1, -1)
        const col = s.replace(/\/P$/, '').split('/')[0]
        return MANA_BG[col] && !/\d/.test(s) ? <Pip key={i} c={col} size={size} /> : <Pip key={i} c="C" size={size} label={s} />
      })}
    </span>
  )
}

// ---- Card image ---------------------------------------------------------------
export function CardImage({ card, className, small, onClick, children }: { card: Card; className?: string; small?: boolean; onClick?: () => void; children?: ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  const src = small ? card.imageSmall ?? card.image : card.image
  return (
    <div className={cx('card-img relative', !loaded && 'shimmer', onClick && 'cursor-pointer', className)} onClick={onClick}>
      {src && (
        <img
          src={src}
          alt={card.name}
          loading="lazy"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cx('w-full h-full object-cover transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {children}
    </div>
  )
}

export function ArtCrop({ card, className }: { card?: Card; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  if (!card?.artCrop) return <div className={cx('bg-ink-700', className)} />
  return (
    <div className={cx(!className?.includes('absolute') && 'relative', 'overflow-hidden', !loaded && 'shimmer', className)}>
      <img src={card.artCrop} alt="" onLoad={() => setLoaded(true)} className={cx('absolute inset-0 w-full h-full object-cover transition-opacity duration-700', loaded ? 'opacity-100' : 'opacity-0')} />
    </div>
  )
}

// ---- The three states: own / need / discovery ---------------------------------------
export type Status = 'own' | 'need' | 'disc'
const STATUS_STYLE: Record<Status, { cls: string; icon: ReactNode; label: string }> = {
  own: { cls: 'text-own bg-own/10 border-own/25', icon: <Check size={12} strokeWidth={2.5} />, label: 'Owned' },
  need: { cls: 'text-need bg-need/10 border-need/25', icon: <ShoppingBag size={12} strokeWidth={2.2} />, label: 'Need' },
  disc: { cls: 'text-disc bg-disc/10 border-disc/25', icon: <Sparkles size={12} strokeWidth={2.2} />, label: 'Discovery' },
}
export function StatusTag({ kind, children, className }: { kind: Status; children?: ReactNode; className?: string }) {
  const s = STATUS_STYLE[kind]
  return (
    <span className={cx('inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-medium', s.cls, className)}>
      {s.icon}
      {children ?? s.label}
    </span>
  )
}

export function OwnershipLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
      <StatusTag kind="own">Cards I own</StatusTag>
      <StatusTag kind="need">Cards I need</StatusTag>
      <StatusTag kind="disc">New discoveries</StatusTag>
    </div>
  )
}

// ---- Progress ring -----------------------------------------------------------------
export function Ring({ pct, size = 56, stroke = 5, children }: { pct: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = pct === 100 ? 'var(--color-own)' : pct >= 85 ? 'var(--color-gold)' : 'var(--color-need)'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(255 255 255 / .08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 1s var(--ease-out-soft)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children ?? <span className="num text-sm font-semibold">{pct}%</span>}</div>
    </div>
  )
}

export function Bar({ pct, className }: { pct: number; className?: string }) {
  const color = pct === 100 ? 'bg-own' : pct >= 85 ? 'bg-gold' : 'bg-need'
  return (
    <div className={cx('h-1.5 rounded-full bg-white/[.07] overflow-hidden', className)}>
      <div className={cx('h-full rounded-full transition-[width] duration-1000', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

const POWER_STYLE: Record<Power, string> = {
  Competitive: 'text-gold border-gold/30 bg-gold/10',
  'High Power': 'text-[#f3a4a4] border-[#f3a4a4]/25 bg-[#f3a4a4]/8',
  'Mid Power': 'text-mana-u border-mana-u/25 bg-mana-u/8',
  Casual: 'text-fg-2 border-white/10 bg-white/5',
}
export function PowerBadge({ power }: { power: Power }) {
  return <span className={cx('inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-medium', POWER_STYLE[power])}>{power}</span>
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center h-6 px-2 rounded-full border border-white/10 bg-white/[.04] text-[11px] text-fg-2', className)}>{children}</span>
}

// ---- Section header ------------------------------------------------------------------
export function SectionHeader({ eyebrow, title, action, className }: { eyebrow?: string; title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-end justify-between gap-4 mb-4', className)}>
      <div>
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h2 className="text-lg md:text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 md:mb-8 rise">
      {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-4xl md:text-5xl">{title}</h1>
          {subtitle && <p className="text-fg-2 mt-2 text-[15px] max-w-xl">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}

// ---- Deck discovery tile ------------------------------------------------------------------
export function DeckTile({ a, compact }: { a: DeckAnalysis; compact?: boolean }) {
  const d = a.deck
  const hero = d.commander ?? d.cards.find((c) => c.card.name === d.keyCards[0])?.card ?? d.cards[0]?.card
  const away = cardsAway(a)
  return (
    <Link to={`/deck/${d.id}`} className="group panel lift overflow-hidden flex flex-col hover:border-white/15">
      <div className="relative h-28 md:h-32">
        <ArtCrop card={hero} className="absolute inset-0 group-hover:scale-[1.04] transition-transform duration-700" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-850 via-ink-850/40 to-transparent" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {d.origin === 'ai' && <StatusTag kind="disc" className="bg-ink-950/75 backdrop-blur">{d.mode === 'lab' ? `Lab${d.experiment ? ` #${String(d.experiment).padStart(3, '0')}` : ''}` : 'AI built'}</StatusTag>}
        </div>
        <div className="absolute top-3 right-3">
          <ManaPips colors={d.colors} size={18} />
        </div>
      </div>
      <div className="p-4 pt-1 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-[17px] tracking-tight truncate">{d.name}</h3>
            <p className="text-fg-3 text-[13px] truncate">{d.strategy}</p>
          </div>
          <div className="text-right shrink-0">
            <div className={cx('num text-xl font-semibold', a.pct === 100 ? 'text-own' : 'text-fg')}>{a.pct}%</div>
            <div className="text-[11px] text-fg-3">ready</div>
          </div>
        </div>
        <Bar pct={a.pct} className="my-3" />
        <div className="grid grid-cols-2 gap-y-1 text-[13px]">
          <span className="text-fg-3">Cards owned</span>
          <span className="num text-right">
            {a.owned}/{a.total}
          </span>
          <span className="text-fg-3">{away ? `${away} missing` : 'Missing'}</span>
          <span className={cx('num text-right', a.costToComplete ? 'text-need' : 'text-own')}>{a.costToComplete ? `${eur(a.costToComplete)} to complete` : '€0 to build'}</span>
        </div>
        {!compact && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t hairline">
            <PowerBadge power={d.power} />
            <Pill>{d.format === 'casual' ? 'Casual' : FORMAT_LABEL[d.format]}</Pill>
            {a.combos.length > 0 && <StatusTag kind="disc">{a.combos.length} combo{a.combos.length > 1 ? 's' : ''}</StatusTag>}
          </div>
        )}
      </div>
    </Link>
  )
}

// ---- Sheet / modal ------------------------------------------------------------------------
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', k)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" style={{ animation: 'rise .3s both' }} onClick={onClose} />
      <div
        className={cx('relative w-full bg-ink-850 border border-white/10 rounded-t-3xl md:rounded-3xl max-h-[92dvh] overflow-y-auto', wide ? 'md:max-w-3xl' : 'md:max-w-lg')}
        style={{ animation: 'rise .4s var(--ease-out-soft) both' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-ink-850/90 backdrop-blur border-b hairline">
          <div className="font-semibold">{title}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---- Toasts -------------------------------------------------------------------------------
type Toast = { id: number; text: ReactNode; action?: { label: string; to: string } }
let toasts: Toast[] = []
const toastListeners = new Set<(t: Toast[]) => void>()
export function toast(text: ReactNode, action?: Toast['action']) {
  const t = { id: Date.now() + Math.random(), text, action }
  toasts = [...toasts, t]
  toastListeners.forEach((l) => l(toasts))
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    toastListeners.forEach((l) => l(toasts))
  }, 4200)
}
export function Toaster() {
  const [list, setList] = useState<Toast[]>([])
  useEffect(() => {
    toastListeners.add(setList)
    return () => void toastListeners.delete(setList)
  }, [])
  return (
    <div className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-24 lg:bottom-8 flex flex-col gap-2 items-center pointer-events-none w-[calc(100%-32px)] max-w-md">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto glass rounded-2xl px-4 py-3 text-sm flex items-center gap-3 shadow-2xl w-full" style={{ animation: 'rise .4s var(--ease-out-soft) both', background: 'rgb(22 24 29 / .92)' }}>
          <div className="flex-1">{t.text}</div>
          {t.action && (
            <Link to={t.action.to} className="text-gold font-medium whitespace-nowrap">
              {t.action.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}

export function CardName({ card }: { card: Card }) {
  return <>{displayName(card)}</>
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="panel p-10 text-center flex flex-col items-center">
      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-fg-2 mb-4">{icon}</div>
      <div className="font-semibold mb-1">{title}</div>
      <p className="text-fg-3 text-sm max-w-sm mb-5">{text}</p>
      {action}
    </div>
  )
}
