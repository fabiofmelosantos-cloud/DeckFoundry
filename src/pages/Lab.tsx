import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FlaskConical, Loader2, RefreshCw } from 'lucide-react'
import { useDiscovery } from '../lib/discovery'
import { generateExperiment } from '../lib/generate'
import { deckHighlights } from '../lib/insights'
import { ArtCrop, ManaPips, PageHeader, StatusTag, cx, eur } from '../components/ui'

export default function Lab() {
  const disc = useDiscovery()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const booted = useRef(false)

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (params.get('surprise')) {
      nav(`/deck/${generateExperiment(true).id}?new=1`, { replace: true })
      return
    }
    // First visit: seed a few experiments so the Lab is never empty
    if (disc.lab.length === 0) for (let i = 0; i < 3; i++) generateExperiment()
  }, [params, nav, disc.lab.length])

  const another = () => {
    setBusy(true)
    setTimeout(() => {
      generateExperiment()
      setBusy(false)
    }, 700)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Deck Lab"
        title={
          <>
            The <span className="italic text-disc">Lab</span>
          </>
        }
        subtitle="No meta. No rules about what you should build. Just possibilities."
        action={
          <button className="btn btn-primary" onClick={another} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Generate another
          </button>
        }
      />

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {busy && (
          <div className="panel p-6 flex flex-col items-center justify-center min-h-[280px] border-disc/30 text-center">
            <FlaskConical size={28} className="text-disc mb-3 animate-pulse" />
            <div className="font-medium">Mixing something new…</div>
            <div className="text-sm text-fg-3">Pairing themes you'd never combine on purpose</div>
          </div>
        )}
        {disc.lab.map((a, i) => {
          const d = a.deck
          const hero = d.cards.find((c) => c.card.name === d.keyCards[0])?.card ?? d.commander
          const hl = deckHighlights(a, 3)
          return (
            <Link key={d.id} to={`/deck/${d.id}`} className="panel overflow-hidden lift hover:border-disc/30 group rise" style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}>
              <div className="relative h-36">
                <ArtCrop card={hero} className="absolute inset-0 group-hover:scale-105 transition-transform duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-850 via-ink-850/50 to-disc/10" />
                <div className="absolute top-4 left-4 font-mono text-xs tracking-widest text-disc bg-black/50 backdrop-blur px-2.5 py-1 rounded-full border border-disc/30">
                  EXPERIMENT #{String(d.experiment ?? 0).padStart(3, '0')}
                </div>
                <div className="absolute top-4 right-4">
                  <ManaPips colors={d.colors} size={18} />
                </div>
              </div>
              <div className="p-5 pt-2">
                <h3 className="text-xl font-semibold tracking-tight">{d.name}</h3>
                <p className="text-sm text-fg-3 mb-4">{d.strategy}</p>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <Mini label="owned" value={`${a.pct}%`} tone={a.pct === 100 ? 'own' : undefined} />
                  <Mini label={a.combos.length ? 'combos' : 'synergies'} value={String(a.combos.length || hl.length)} tone="disc" />
                  <Mini label="to complete" value={a.costToComplete ? eur(a.costToComplete) : '€0'} tone={a.costToComplete ? 'need' : 'own'} />
                </div>
                {hl[0] && (
                  <p className="text-xs text-fg-3 line-clamp-2 mb-4">
                    <span className="text-fg-2">{hl[0].a.name.split(' // ')[0]}</span> + <span className="text-fg-2">{hl[0].b.name.split(' // ')[0]}</span> — {hl[0].text.toLowerCase()}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <StatusTag kind="disc">{d.format === 'commander' ? 'Commander' : 'Original'}</StatusTag>
                  <span className="text-sm text-disc group-hover:translate-x-0.5 transition-transform">Explore →</span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'own' | 'need' | 'disc' }) {
  return (
    <div className="rounded-xl bg-white/[.03] border border-white/5 px-3 py-2">
      <div className={cx('num font-semibold text-sm', tone === 'own' && 'text-own', tone === 'need' && 'text-need', tone === 'disc' && 'text-disc')}>{value}</div>
      <div className="text-[11px] text-fg-3">{label}</div>
    </div>
  )
}
