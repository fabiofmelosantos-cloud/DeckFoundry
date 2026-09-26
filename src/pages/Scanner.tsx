import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Camera, Check, ChevronLeft, Minus, Plus, RotateCcw, ScanLine, Search, Sparkles, Trash2, Zap } from 'lucide-react'
import type { Card } from '../lib/types'
import { CARDS, isBasic, price, searchCards } from '../lib/cardDb'
import { addToCollection, useOwned } from '../lib/store'
import { useDiscovery } from '../lib/discovery'
import { mulberry32, shuffle } from '../lib/random'
import { CardImage, Sheet, StatusTag, cx, eur } from '../components/ui'

// Recognition here is simulated: detections are drawn from the card database.
// The pipeline (detect → confidence → review → confirm) is the real UX; swapping
// in a recognition model only needs to replace the "Progressive detection loop" effect.

interface Detection {
  key: number
  card: Card
  confidence: number
  alternatives: Card[]
  qty: number
  foil: boolean
  slot: number
}

type Phase = 'intro' | 'scanning' | 'review' | 'done'
const SLOTS = 16

export default function Scanner() {
  const nav = useNavigate()
  const disc = useDiscovery()
  const owned = useOwned()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [camera, setCamera] = useState<'pending' | 'on' | 'demo'>('pending')
  const [dets, setDets] = useState<Detection[]>([])
  const [batchTarget, setBatchTarget] = useState(0)
  const [editing, setEditing] = useState<Detection | null>(null)
  const [result, setResult] = useState<{ count: number; value: number; decks: string[] } | null>(null)
  const seedRef = useRef(Date.now())

  // Candidate pool — biased toward cards that complete your decks, like a real haul would.
  const pool = useMemo(() => {
    const missing = disc.all.flatMap((a) => a.missing.map((m) => m.card))
    const rest = CARDS.filter((c) => !isBasic(c))
    const rand = mulberry32(seedRef.current)
    return shuffle([...shuffle(missing, rand).slice(0, 14), ...shuffle(rest, rand).slice(0, 30)], rand)
  }, [disc.all])

  const startCamera = async () => {
    setPhase('scanning')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCamera('on')
    } catch {
      setCamera('demo')
    }
    capture()
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])
  useEffect(() => {
    if (camera === 'on' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [camera, phase])

  // Progressive detection loop
  useEffect(() => {
    if (phase !== 'scanning' || dets.length >= batchTarget) return
    const t = setTimeout(() => {
      setDets((d) => {
        const used = new Set(d.map((x) => x.slot))
        const free = [...Array(SLOTS).keys()].filter((s) => !used.has(s % SLOTS) || d.length >= SLOTS)
        const card = pool[d.length % pool.length]
        const r = Math.random()
        const confidence = r < 0.18 ? 0.62 + Math.random() * 0.18 : 0.9 + Math.random() * 0.095
        const alternatives = CARDS.filter((c) => c.id !== card.id && !isBasic(c) && (c.name[0] === card.name[0] || c.colors.join() === card.colors.join()) && Math.abs(c.cmc - card.cmc) <= 1).slice(0, 3)
        return [...d, { key: Date.now() + Math.random(), card, confidence, alternatives, qty: 1, foil: Math.random() < 0.06, slot: free[Math.floor(Math.random() * free.length)] ?? d.length % SLOTS }]
      })
    }, 380 + Math.random() * 520)
    return () => clearTimeout(t)
  }, [phase, dets.length, batchTarget, pool])

  const capture = () => setBatchTarget((n) => Math.max(n, dets.length) + 10 + Math.floor(Math.random() * 8))
  const detecting = dets.length < batchTarget
  const low = dets.filter((d) => d.confidence < 0.8)
  const total = dets.reduce((a, d) => a + d.qty, 0)
  const value = dets.reduce((a, d) => a + price(d.card, d.foil) * d.qty, 0)
  const visible = dets.slice(-SLOTS)

  const update = (key: number, patch: Partial<Detection>) => setDets((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const remove = (key: number) => setDets((d) => d.filter((x) => x.key !== key))

  const confirm = () => {
    const names = new Set(dets.map((d) => d.card.name))
    const improved = disc.all.filter((a) => a.missing.some((m) => names.has(m.card.name))).map((a) => a.deck.name)
    addToCollection(dets.map((d) => ({ cardId: d.card.id, qty: d.qty, foil: d.foil })))
    setResult({ count: total, value, decks: improved })
    setPhase('done')
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  return (
    <div className="fixed inset-0 z-50 bg-black text-fg flex flex-col lg:left-64">
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-black/80 to-transparent">
        <button onClick={() => (phase === 'review' ? setPhase('scanning') : nav(-1))} className="w-10 h-10 rounded-full glass flex items-center justify-center" aria-label="Back">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold">{phase === 'review' ? 'Review scan' : phase === 'done' ? 'Added' : 'Card scanner'}</div>
          {phase === 'scanning' && <div className="text-[11px] text-fg-3">{camera === 'demo' ? 'Demo mode · no camera found' : 'Recognition preview'}</div>}
        </div>
        <div className="w-10 h-10 rounded-full glass flex items-center justify-center text-fg-3">
          <Zap size={17} />
        </div>
      </div>

      {phase === 'intro' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center" style={{ background: 'radial-gradient(600px 400px at 50% 30%, rgb(231 198 127 / .09), transparent 70%), #07080a' }}>
          <div className="relative w-64 h-44 mb-10">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="absolute w-20 aspect-[488/680] rounded-lg border border-white/15 bg-gradient-to-br from-ink-700 to-ink-800"
                style={{ left: `${10 + (i % 3) * 30}%`, top: `${i < 3 ? 0 : 42}%`, transform: `rotate(${(i - 2.5) * 3}deg)`, animation: `rise .7s ${i * 70}ms both` }}
              />
            ))}
            <div className="absolute inset-[-12px] rounded-2xl border-2 border-gold/60" style={{ maskImage: 'linear-gradient(90deg,#000 12%,transparent 12% 88%,#000 88%), linear-gradient(#000 16%,transparent 16% 84%,#000 84%)', WebkitMaskComposite: 'source-over' }} />
            <div className="absolute inset-x-[-12px] h-0.5 bg-gold shadow-[0_0_16px_2px_rgb(231,198,127)]" style={{ animation: 'scanline 2.4s ease-in-out infinite' }} />
          </div>
          <h1 className="display text-4xl mb-3">Scan 10–20 cards at once</h1>
          <p className="text-fg-2 max-w-sm mb-8">Lay your cards flat in a grid, in good light. DeckFoundry spots each one and adds it to your collection.</p>
          <button className="btn btn-primary h-14 px-8 text-base" onClick={startCamera}>
            <Camera size={19} /> Start scanning
          </button>
          <div className="flex gap-6 mt-10 text-xs text-fg-3">
            <span>Flat surface</span>
            <span>No glare</span>
            <span>Face up</span>
          </div>
        </div>
      )}

      {(phase === 'scanning' || phase === 'review') && (
        <div className={cx('relative flex-1 overflow-hidden', phase === 'review' && 'hidden')}>
          <video ref={videoRef} playsInline muted className={cx('absolute inset-0 w-full h-full object-cover', camera !== 'on' && 'hidden')} />
          {camera !== 'on' && <DemoTable />}
          <div className="absolute inset-0 bg-black/20" />

          {/* detection grid */}
          <div className="absolute inset-x-3 top-20 bottom-[270px] md:inset-x-[12%] grid grid-cols-4 grid-rows-4 gap-2 md:gap-3">
            {[...Array(SLOTS)].map((_, i) => {
              const d = visible.find((x) => x.slot === i)
              return (
                <div key={i} className="relative">
                  {d && (
                    <div key={d.key} className={cx('absolute inset-0 rounded-lg border-2', d.confidence < 0.8 ? 'border-need' : 'border-own')} style={{ animation: 'lock .45s var(--ease-out-soft) both', boxShadow: `0 0 18px -4px ${d.confidence < 0.8 ? '#f0b25a' : '#5fd4a0'}` }}>
                      {camera !== 'on' && d.card.imageSmall && <img src={d.card.imageSmall} alt="" className="absolute inset-0 w-full h-full object-cover rounded-md opacity-80" />}
                      <div className="absolute bottom-1 inset-x-1 text-[9px] md:text-[10px] px-1 py-0.5 rounded bg-black/85 border border-white/10 truncate text-center">
                        {d.card.name.split(' // ')[0]} <span className={d.confidence < 0.8 ? 'text-need' : 'text-own'}>{Math.round(d.confidence * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {detecting && <div className="absolute inset-x-0 h-0.5 bg-gold shadow-[0_0_20px_3px_rgb(231,198,127)]" style={{ animation: 'scanline 1.8s ease-in-out infinite' }} />}
          </div>

          {/* bottom tray */}
          <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black via-black/90 to-transparent pt-10 pb-[max(20px,env(safe-area-inset-bottom))] px-4">
            <div className="flex items-center justify-between mb-3 max-w-xl mx-auto">
              <div>
                <div className="text-2xl font-semibold num">
                  {dets.length} <span className="text-base text-fg-3 font-normal">cards detected</span>
                </div>
                <div className="text-xs text-fg-3 flex items-center gap-2">
                  {detecting ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" /> Identifying…
                    </>
                  ) : (
                    'Hold steady or capture another batch'
                  )}
                  {low.length > 0 && <span className="text-need">· {low.length} to check</span>}
                </div>
              </div>
              <div className="num text-sm text-fg-2">{eur(value)}</div>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 max-w-xl mx-auto min-h-[64px]">
              {[...dets].reverse().map((d) => (
                <div key={d.key} className="relative shrink-0" style={{ animation: 'pop .35s both' }}>
                  <CardImage card={d.card} small className={cx('w-11 ring-2', d.confidence < 0.8 ? 'ring-need' : 'ring-transparent')} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-6 max-w-xl mx-auto">
              <button className="w-12 h-12 rounded-full glass flex items-center justify-center" onClick={() => { setDets([]); setBatchTarget(0) }} aria-label="Reset">
                <RotateCcw size={18} />
              </button>
              <button className="w-[72px] h-[72px] rounded-full border-4 border-white/80 flex items-center justify-center active:scale-95 transition" onClick={capture} aria-label="Capture batch">
                <span className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center text-ink-950">
                  <ScanLine size={22} />
                </span>
              </button>
              <button className={cx('h-12 px-5 rounded-full font-medium flex items-center gap-2 transition', dets.length ? 'btn-primary' : 'glass text-fg-3')} disabled={!dets.length} onClick={() => setPhase('review')}>
                Review <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'review' && (
        <div className="flex-1 overflow-y-auto bg-ink-950 pt-20 pb-40">
          <div className="max-w-2xl mx-auto px-4">
            <div className="flex items-end justify-between mb-5">
              <div>
                <h1 className="display text-4xl">{total} cards found</h1>
                <p className="text-fg-3 text-sm mt-1">Tap a card to correct it. Only confirmed cards join your collection.</p>
              </div>
            </div>
            {low.length > 0 && (
              <div className="flex items-center gap-3 rounded-2xl border border-need/25 bg-need/[.07] p-3 mb-4 text-sm">
                <AlertTriangle size={17} className="text-need shrink-0" />
                {low.length} card{low.length > 1 ? 's' : ''} had low confidence — please double-check {low.length > 1 ? 'them' : 'it'}.
              </div>
            )}
            <ul className="space-y-2">
              {[...dets].sort((a, b) => a.confidence - b.confidence).map((d) => {
                const have = owned.get(d.card.name) ?? 0
                return (
                  <li key={d.key} className={cx('panel p-3 flex gap-3 items-center', d.confidence < 0.8 && 'border-need/30')}>
                    <button onClick={() => setEditing(d)} className="shrink-0">
                      <CardImage card={d.card} small className="w-12" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <button onClick={() => setEditing(d)} className="text-left w-full">
                        <div className="font-medium text-sm truncate">{d.card.name.split(' // ')[0]}</div>
                        <div className="text-xs text-fg-3 truncate">
                          {d.card.setName} · <span className={d.confidence < 0.8 ? 'text-need' : 'text-own'}>{Math.round(d.confidence * 100)}% match</span>
                        </div>
                      </button>
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {have === 0 ? <StatusTag kind="disc">New to you</StatusTag> : <StatusTag kind="own">You have {have}</StatusTag>}
                        <button className="chip h-6 text-[11px] px-2" data-on={d.foil} onClick={() => update(d.key, { foil: !d.foil })}>
                          Foil
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center" onClick={() => (d.qty > 1 ? update(d.key, { qty: d.qty - 1 }) : remove(d.key))} aria-label="Less">
                        {d.qty > 1 ? <Minus size={14} /> : <Trash2 size={14} className="text-fg-3" />}
                      </button>
                      <span className="num w-5 text-center text-sm">{d.qty}</span>
                      <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center" onClick={() => update(d.key, { qty: d.qty + 1 })} aria-label="More">
                        <Plus size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="fixed bottom-0 inset-x-0 lg:left-64 bg-ink-950/90 backdrop-blur-xl border-t hairline p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="max-w-2xl mx-auto flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm">
                  <span className="num font-semibold">{total}</span> cards · <span className="num">{eur(value)}</span>
                </div>
                <div className="text-xs text-fg-3">{dets.filter((d) => !owned.get(d.card.name)).length} new to your collection</div>
              </div>
              <button className="btn btn-ghost" onClick={() => setPhase('scanning')}>
                Scan more
              </button>
              <button className="btn btn-primary" onClick={confirm} disabled={!dets.length}>
                <Check size={16} /> Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 bg-ink-950" style={{ background: 'radial-gradient(600px 400px at 50% 35%, rgb(95 212 160 / .09), transparent 70%), #07080a' }}>
          <div className="w-20 h-20 rounded-full bg-own/15 text-own flex items-center justify-center mb-6" style={{ animation: 'pop .5s both' }}>
            <Check size={36} strokeWidth={2.4} />
          </div>
          <h1 className="display text-5xl mb-2">{result.count} cards added</h1>
          <p className="text-fg-2 mb-6">
            Worth <span className="num text-fg">{eur(result.value)}</span>
          </p>
          {result.decks.length > 0 && (
            <div className="panel p-4 max-w-sm w-full text-left mb-8">
              <div className="flex items-center gap-2 text-disc text-sm font-medium mb-2">
                <Sparkles size={15} /> This scan moved {result.decks.length} deck{result.decks.length > 1 ? 's' : ''} closer
              </div>
              <div className="text-sm text-fg-2">{result.decks.slice(0, 5).join(' · ')}</div>
            </div>
          )}
          <div className="flex gap-3">
            <button className="btn btn-ghost" onClick={() => { setDets([]); setBatchTarget(0); setResult(null); setPhase('intro') }}>
              Scan more
            </button>
            <button className="btn btn-primary" onClick={() => nav('/discover')}>
              Here's what you can build <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      <FixSheet
        det={editing}
        onClose={() => setEditing(null)}
        onPick={(card) => {
          if (editing) update(editing.key, { card, confidence: 1 })
          setEditing(null)
        }}
      />
    </div>
  )
}

function FixSheet({ det, onClose, onPick }: { det: Detection | null; onClose: () => void; onPick: (c: Card) => void }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => searchCards(q, 6), [q])
  if (!det) return null
  return (
    <Sheet open={!!det} onClose={onClose} title="Is this the right card?">
      <div className="flex gap-4 mb-5">
        <CardImage card={det.card} className="w-28 shrink-0" />
        <div>
          <div className="font-semibold">{det.card.name}</div>
          <div className="text-sm text-fg-3 mb-3">{det.card.setName}</div>
          <button className="btn btn-primary btn-sm" onClick={() => onPick(det.card)}>
            <Check size={14} /> Yes, it's correct
          </button>
        </div>
      </div>
      {det.alternatives.length > 0 && (
        <>
          <div className="eyebrow mb-2">Did you mean</div>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {det.alternatives.map((c) => (
              <button key={c.id} onClick={() => onPick(c)} className="text-left">
                <CardImage card={c} small />
                <div className="text-xs mt-1 truncate">{c.name.split(' // ')[0]}</div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="eyebrow mb-2">Search instead</div>
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3" />
        <input className="input pl-10" placeholder="Card name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="mt-2">
        {results.map((c) => (
          <li key={c.id}>
            <button className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 text-left" onClick={() => onPick(c)}>
              <CardImage card={c} small className="w-8" />
              <span className="text-sm flex-1 truncate">{c.name}</span>
              <span className="text-xs text-fg-3">{c.set.toUpperCase()}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

/** Stand-in backdrop when no camera is available (desktop, denied permission). */
function DemoTable() {
  return (
    <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, #2a2420 0%, #14110f 55%, #080706 100%)' }}>
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgb(255 255 255/.02) 0 2px, transparent 2px 7px)' }} />
      <div className="absolute inset-x-3 top-20 bottom-[270px] md:inset-x-[12%] grid grid-cols-4 grid-rows-4 gap-2 md:gap-3 opacity-60">
        {[...Array(SLOTS)].map((_, i) => (
          <div key={i} className="rounded-lg bg-gradient-to-br from-[#3a3530] to-[#1d1a17] border border-white/5" style={{ transform: `rotate(${((i * 37) % 7) - 3}deg)` }} />
        ))}
      </div>
    </div>
  )
}
