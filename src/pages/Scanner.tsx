import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Camera, Check, ChevronLeft, ImagePlus, Loader2, Minus, Plus, RotateCcw, Search, Sparkles, Trash2, Undo2, Zap, ZapOff } from 'lucide-react'
import type { Card } from '../lib/types'
import { displayName, price, searchCards } from '../lib/cardDb'
import { addToCollection, useOwned } from '../lib/store'
import { useDiscovery } from '../lib/discovery'
import { ocrWorker, prepare, readRegion, REGIONS, titleVariants, type Rect } from '../lib/scanner/ocr'
import { identify, identifyByTitles, knownSets, lookupName, printingsOf, type ScanResult } from '../lib/scanner/identify'
import { CardImage, Sheet, StatusTag, cx, eur } from '../components/ui'

// Real card scanner: hold one card inside the frame. The bottom-left collector
// line (set code + number + language) identifies the exact printing; the title
// confirms it. Everything runs on the phone (Tesseract OCR) — only the card
// lookup goes to Scryfall.

interface Detection {
  key: number
  card: Card
  confidence: number
  exact: boolean
  how: ScanResult['how']
  qty: number
  foil: boolean
}

type Phase = 'intro' | 'scanning' | 'review' | 'done'
const CARD_RATIO = 63 / 88
const SCAN_INTERVAL = 350

export default function Scanner() {
  const nav = useNavigate()
  const disc = useDiscovery()
  const owned = useOwned()
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  // Detection bookkeeping for the live loop:
  //  last     – the card most recently added (by name, so another printing's misread doesn't count as new)
  //  empty    – the frame has been empty since then (the card was taken away)
  //  pending  – a candidate seen once, waiting for a second matching read
  const track = useRef<{ last: string | null; empty: boolean; pending: string | null }>({ last: null, empty: true, pending: null })
  const [phase, setPhase] = useState<Phase>('intro')
  const [camera, setCamera] = useState<'pending' | 'on' | 'off'>('pending')
  const [engine, setEngine] = useState<'loading' | 'ready' | 'error'>('loading')
  const [status, setStatus] = useState('Fit a card inside the frame')
  const [flash, setFlash] = useState(0)
  const [torch, setTorch] = useState<boolean | null>(null)
  const [dets, setDets] = useState<Detection[]>([])
  const [editing, setEditing] = useState<Detection | null>(null)
  const [result, setResult] = useState<{ count: number; value: number; decks: string[] } | null>(null)
  const [photoBusy, setPhotoBusy] = useState<{ done: number; total: number } | null>(null)

  const add = useCallback((r: ScanResult) => {
    setDets((d) => [{ key: Date.now() + Math.random(), card: r.card, confidence: r.confidence, exact: r.exactPrinting, how: r.how, qty: 1, foil: false }, ...d])
    setFlash((f) => f + 1)
    navigator.vibrate?.(40)
  }, [])

  // ---- camera ------------------------------------------------------------------------------------
  const start = async () => {
    setPhase('scanning')
    // Warm up the OCR engine and the set list in parallel with the camera
    ocrWorker().then(
      () => setEngine('ready'),
      () => setEngine('error'),
    )
    knownSets().catch(() => {})
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }
      if (caps.torch) setTorch(false)
      if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCamera('on')
    } catch {
      setCamera('off')
    }
  }
  const stopCamera = () => streamRef.current?.getTracks().forEach((t) => t.stop())
  useEffect(() => stopCamera, [])
  useEffect(() => {
    if (camera === 'on' && phase === 'scanning' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [camera, phase])

  const toggleTorch = () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || torch == null) return
    track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).then(() => setTorch(!torch), () => setTorch(null))
  }

  /** The guide frame, mapped from screen pixels to video pixels (the video is object-cover). */
  const cardRectInVideo = (): Rect | null => {
    const v = videoRef.current
    const stage = stageRef.current
    const frame = frameRef.current
    if (!v || !stage || !frame || !v.videoWidth) return null
    const s = stage.getBoundingClientRect()
    const f = frame.getBoundingClientRect()
    const scale = Math.max(s.width / v.videoWidth, s.height / v.videoHeight)
    const ox = (s.width - v.videoWidth * scale) / 2
    const oy = (s.height - v.videoHeight * scale) / 2
    return { x: (f.left - s.left - ox) / scale, y: (f.top - s.top - oy) / scale, w: f.width / scale, h: f.height / scale }
  }

  /** Reads one card from any image source + the rectangle the card occupies in it. */
  const readCard = useCallback(async (src: CanvasImageSource, rect: Rect) => {
    const infoImg = prepare(src, rect, REGIONS.info, 90)
    const titleImg = prepare(src, rect, REGIONS.title, 96)
    const info = await readRegion(infoImg, 'info')
    const title = await readRegion(titleImg, 'title')
    let r = await identify(info.text, title.text)
    let variants: string[] = []
    let timing: { ocr: number; lookup: number } | null = null
    // No collector line (older cards) and a weak title: try harder readings of the title,
    // but only when there's clearly text there — an empty frame shouldn't burn battery
    if ((!r || (r.how === 'name' && r.confidence < 0.8)) && title.text.replace(/[^A-Za-z]/g, '').length >= 4) {
      const t0 = performance.now()
      variants = await titleVariants(src, rect)
      const t1 = performance.now()
      const better = await identifyByTitles([title.text, ...variants])
      timing = { ocr: Math.round(t1 - t0), lookup: Math.round(performance.now() - t1) }
      if (better && (!r || better.confidence > r.confidence)) r = better
    }
    // Diagnostics for tuning: localStorage 'deckfoundry:scanDebug' = '1'
    try {
      if (localStorage.getItem('deckfoundry:scanDebug')) {
        const w = window as unknown as { __scanLog?: unknown[] }
        ;(w.__scanLog ??= []).push({ infoImg: infoImg.toDataURL(), titleImg: titleImg.toDataURL(), variants, timing, info: info.text, title: title.text, card: r?.card.name, set: r?.card.set, number: r?.card.collectorNumber, how: r?.how, confidence: r?.confidence })
      }
    } catch {
      /* ignore */
    }
    return r
  }, [])

  // ---- continuous scanning loop -------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'scanning' || camera !== 'on' || engine !== 'ready') return
    let alive = true
    const tick = async () => {
      if (!alive) return
      if (!busy.current && videoRef.current && !editing) {
        const rect = cardRectInVideo()
        if (rect) {
          busy.current = true
          try {
            const r = await readCard(videoRef.current, rect)
            const t = track.current
            if (r && r.confidence >= 0.7) {
              const name = r.card.name
              if (name === t.last && !t.empty) {
                setStatus(`${displayName(r.card)} added — next card`) // same card still in the frame
              } else if (r.how === 'collector+name' || t.pending === name) {
                // Collector line and title agree, or two reads in a row agree: add it
                add(r)
                track.current = { last: name, empty: false, pending: null }
                setStatus(`${displayName(r.card)} added — next card`)
              } else {
                t.pending = name
                setStatus('Almost — hold steady')
              }
            } else {
              if (!r) t.empty = true
              t.pending = null
              setStatus(r ? 'Almost — hold steady' : 'Fit a card inside the frame')
            }
          } catch {
            setStatus('Could not read — try more light')
          } finally {
            busy.current = false
          }
        }
      }
      if (alive) setTimeout(tick, SCAN_INTERVAL)
    }
    tick()
    return () => {
      alive = false
    }
  }, [phase, camera, engine, editing, readCard, add])

  // ---- photos (gallery or a sharper still) ----------------------------------------------------------
  const readPhotos = async (files: FileList) => {
    setPhase('scanning')
    await ocrWorker().then(() => setEngine('ready'))
    setPhotoBusy({ done: 0, total: files.length })
    let misses = 0
    for (let i = 0; i < files.length; i++) {
      const bmp = await createImageBitmap(files[i])
      // A photo is treated as the card itself — crop tightly to the card for best results
      const r = await readCard(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }).catch(() => null)
      if (r) add(r)
      else misses++
      setPhotoBusy({ done: i + 1, total: files.length })
    }
    setPhotoBusy(null)
    setStatus(misses ? `${misses} photo${misses > 1 ? 's' : ''} couldn't be read — crop to the card and retry` : 'Photos read')
  }

  // ---- review helpers ---------------------------------------------------------------------------------------
  const total = dets.reduce((a, d) => a + d.qty, 0)
  const value = dets.reduce((a, d) => a + price(d.card, d.foil) * d.qty, 0)
  const unsure = dets.filter((d) => d.confidence < 0.8 || !d.exact)
  const update = (key: number, patch: Partial<Detection>) => setDets((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const remove = (key: number) => setDets((d) => d.filter((x) => x.key !== key))
  const confirm = () => {
    const names = new Set(dets.map((d) => d.card.name))
    const improved = disc.all.filter((a) => a.missing.some((m) => names.has(m.card.name))).map((a) => a.deck.name)
    addToCollection(dets.map((d) => ({ cardId: d.card.id, qty: d.qty, foil: d.foil })))
    setResult({ count: total, value, decks: improved })
    setPhase('done')
    stopCamera()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black text-fg flex flex-col lg:left-64">
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && readPhotos(e.target.files)} />

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-black/80 to-transparent">
        <button onClick={() => (phase === 'review' ? setPhase('scanning') : (stopCamera(), nav(-1)))} className="w-10 h-10 rounded-full glass flex items-center justify-center" aria-label="Back">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold">{phase === 'review' ? 'Review scan' : phase === 'done' ? 'Added' : 'Card scanner'}</div>
          {phase === 'scanning' && (
            <div className="text-[11px] text-fg-3">{engine === 'loading' ? 'Loading the reader…' : engine === 'error' ? 'Reader failed to load' : camera === 'off' ? 'No camera — use photos' : 'Reading on your phone'}</div>
          )}
        </div>
        <button className="w-10 h-10 rounded-full glass flex items-center justify-center text-fg-2 disabled:opacity-30" onClick={toggleTorch} disabled={torch == null} aria-label="Torch">
          {torch ? <Zap size={17} className="text-gold" /> : <ZapOff size={17} />}
        </button>
      </div>

      {phase === 'intro' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center" style={{ background: 'radial-gradient(600px 400px at 50% 30%, rgb(231 198 127 / .09), transparent 70%), #07080a' }}>
          <div className="relative w-40 aspect-[63/88] mb-10 rounded-xl border border-white/15 bg-gradient-to-br from-ink-700 to-ink-800">
            <div className="absolute inset-x-3 top-3 h-3 rounded bg-gold/30" />
            <div className="absolute left-3 bottom-3 w-16 h-4 rounded bg-gold/60" />
            <div className="absolute inset-[-10px] rounded-2xl border-2 border-gold/60" />
            <div className="absolute inset-x-[-10px] h-0.5 bg-gold shadow-[0_0_16px_2px_rgb(231,198,127)]" style={{ animation: 'scanline 2.4s ease-in-out infinite' }} />
          </div>
          <h1 className="display text-4xl mb-3">Scan your cards</h1>
          <p className="text-fg-2 max-w-sm mb-2">Hold one card at a time inside the frame. DeckFoundry reads the set code and number in the bottom-left corner to find the exact printing.</p>
          <p className="text-fg-3 text-sm max-w-sm mb-8">Cards from before 2014 have no set code — they're matched by name and you pick the edition.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button className="btn btn-primary h-14 px-8 text-base" onClick={start}>
              <Camera size={19} /> Start scanning
            </button>
            <button className="btn btn-ghost h-14 px-6" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={18} /> Use photos
            </button>
          </div>
          <div className="flex gap-6 mt-10 text-xs text-fg-3">
            <span>Good light</span>
            <span>Card flat</span>
            <span>Corner in focus</span>
          </div>
        </div>
      )}

      {(phase === 'scanning' || phase === 'review') && (
        <div ref={stageRef} className={cx('relative flex-1 overflow-hidden', phase === 'review' && 'hidden')}>
          <video ref={videoRef} playsInline muted className={cx('absolute inset-0 w-full h-full object-cover', camera !== 'on' && 'hidden')} />
          {camera !== 'on' && <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, #1d1f25, #07080a)' }} />}

          {/* Guide frame: everything outside it is dimmed */}
          <div className="absolute inset-0 flex items-center justify-center pb-40 pt-16">
            <div
              ref={frameRef}
              key={flash}
              className="relative rounded-[18px]"
              style={{
                height: 'min(62vh, calc((100vw - 64px) / 0.716))',
                aspectRatio: String(CARD_RATIO),
                boxShadow: '0 0 0 100vmax rgb(0 0 0 / .55)',
                animation: flash ? 'lock .5s var(--ease-out-soft)' : undefined,
                outline: flash ? '3px solid var(--color-own)' : '2px solid rgb(231 198 127 / .8)',
                outlineOffset: 2,
              }}
            >
              <div className="absolute rounded border border-dashed border-white/35" style={{ left: `${REGIONS.title.x * 100}%`, top: `${REGIONS.title.y * 100}%`, width: `${REGIONS.title.w * 100}%`, height: `${REGIONS.title.h * 100}%` }} />
              <div className="absolute rounded border border-dashed border-gold/70" style={{ left: `${REGIONS.info.x * 100}%`, top: `${REGIONS.info.y * 100}%`, width: `${REGIONS.info.w * 100}%`, height: `${REGIONS.info.h * 100}%` }} />
              <span className="absolute left-2 -bottom-6 text-[10px] text-gold/90 whitespace-nowrap">set code · number</span>
              {camera === 'on' && engine === 'ready' && <div className="absolute inset-x-0 h-0.5 bg-gold/70 shadow-[0_0_14px_2px_rgb(231,198,127)]" style={{ animation: 'scanline 2.2s ease-in-out infinite' }} />}
              {camera === 'off' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 gap-3">
                  <p className="text-sm text-fg-2">No camera available here. Add photos of your cards instead — crop each photo to the card.</p>
                  <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                    <ImagePlus size={15} /> Choose photos
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom tray */}
          <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black via-black/90 to-transparent pt-8 pb-[max(20px,env(safe-area-inset-bottom))] px-4">
            <div className="max-w-xl mx-auto">
              <div className="flex items-center gap-2 text-sm mb-3 min-h-[20px]">
                {engine === 'loading' || photoBusy ? <Loader2 size={14} className="animate-spin text-gold" /> : <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />}
                <span className="text-fg-2 truncate">{photoBusy ? `Reading photo ${Math.min(photoBusy.done + 1, photoBusy.total)} of ${photoBusy.total}…` : engine === 'loading' ? 'Preparing the reader (first time only)…' : status}</span>
              </div>
              {dets[0] && (
                <div className="flex items-center gap-3 rounded-2xl bg-white/[.06] border border-white/10 p-2 mb-3" style={{ animation: 'rise .35s both' }} key={dets[0].key}>
                  <CardImage card={dets[0].card} small className="w-10 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{displayName(dets[0].card)}</div>
                    <div className="text-[11px] text-fg-3 truncate">
                      {dets[0].card.setName} #{dets[0].card.collectorNumber} · {dets[0].exact ? <span className="text-own">exact printing</span> : <span className="text-need">check edition</span>}
                    </div>
                  </div>
                  <button className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center" onClick={() => update(dets[0].key, { qty: dets[0].qty + 1 })} aria-label="One more copy">
                    <span className="text-xs font-semibold num">+1</span>
                  </button>
                  <button className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-fg-3" onClick={() => remove(dets[0].key)} aria-label="Undo">
                    <Undo2 size={15} />
                  </button>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <button className="w-12 h-12 rounded-full glass flex items-center justify-center" onClick={() => fileRef.current?.click()} aria-label="Add photos">
                  <ImagePlus size={18} />
                </button>
                <div className="text-center">
                  <div className="text-2xl font-semibold num">{total}</div>
                  <div className="text-[11px] text-fg-3">cards · {eur(value)}</div>
                </div>
                <button className={cx('h-12 px-5 rounded-full font-medium flex items-center gap-2 transition', dets.length ? 'btn-primary' : 'glass text-fg-3')} disabled={!dets.length} onClick={() => setPhase('review')}>
                  Review <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === 'review' && (
        <div className="flex-1 overflow-y-auto bg-ink-950 pt-20 pb-40">
          <div className="max-w-2xl mx-auto px-4">
            <h1 className="display text-4xl mb-1">{total} cards found</h1>
            <p className="text-fg-3 text-sm mb-5">Tap a card to fix it or pick the right edition. Only confirmed cards join your collection.</p>
            {unsure.length > 0 && (
              <div className="flex items-center gap-3 rounded-2xl border border-need/25 bg-need/[.07] p-3 mb-4 text-sm">
                <AlertTriangle size={17} className="text-need shrink-0" />
                {unsure.length} card{unsure.length > 1 ? 's need' : ' needs'} a quick check (edition or name).
              </div>
            )}
            <ul className="space-y-2">
              {[...dets].sort((a, b) => Number(a.exact && a.confidence >= 0.8) - Number(b.exact && b.confidence >= 0.8)).map((d) => {
                const have = owned.get(d.card.name) ?? 0
                const check = d.confidence < 0.8 || !d.exact
                return (
                  <li key={d.key} className={cx('panel p-3 flex gap-3 items-center', check && 'border-need/30')}>
                    <button onClick={() => setEditing(d)} className="shrink-0">
                      <CardImage card={d.card} small className="w-12" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <button onClick={() => setEditing(d)} className="text-left w-full">
                        <div className="font-medium text-sm truncate">{displayName(d.card)}</div>
                        <div className="text-xs text-fg-3 truncate">
                          {d.card.setName} #{d.card.collectorNumber} · {check ? <span className="text-need">check {d.exact ? 'name' : 'edition'}</span> : <span className="text-own">exact</span>}
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
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDets([])
                setResult(null)
                setPhase('intro')
              }}
            >
              <RotateCcw size={15} /> Scan more
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
        onPick={(card, exact) => {
          if (editing) update(editing.key, { card, confidence: 1, exact })
          setEditing(null)
        }}
      />
    </div>
  )
}

/** Correct a scan: confirm it, choose another edition, or search by name. */
function FixSheet({ det, onClose, onPick }: { det: Detection | null; onClose: () => void; onPick: (c: Card, exact: boolean) => void }) {
  const [q, setQ] = useState('')
  const [prints, setPrints] = useState<Card[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [online, setOnline] = useState<Card | null>(null)
  const results = useMemo(() => searchCards(q, 6), [q])
  useEffect(() => {
    setPrints(null)
    setQ('')
    setOnline(null)
    if (det) printingsOf(det.card).then(setPrints, () => setPrints([det.card]))
  }, [det])
  if (!det) return null
  return (
    <Sheet open={!!det} onClose={onClose} title="Is this right?" wide>
      <div className="flex gap-4 mb-5">
        <CardImage card={det.card} className="w-28 shrink-0" />
        <div>
          <div className="font-semibold">{det.card.name}</div>
          <div className="text-sm text-fg-3 mb-3">
            {det.card.setName} #{det.card.collectorNumber}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onPick(det.card, true)}>
            <Check size={14} /> Yes, this exact card
          </button>
        </div>
      </div>
      <div className="eyebrow mb-2">Other editions</div>
      {!prints ? (
        <div className="text-sm text-fg-3 flex items-center gap-2 mb-5">
          <Loader2 size={14} className="animate-spin" /> Loading editions…
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-5">
          {prints.map((c) => (
            <button key={c.id} onClick={() => onPick(c, true)} className={cx('w-20 shrink-0 text-left', c.id === det.card.id && 'opacity-50')}>
              <CardImage card={c} small />
              <div className="text-[10px] mt-1 truncate">{c.setName}</div>
              <div className="text-[10px] text-fg-3 num">
                #{c.collectorNumber} · {eur(price(c))}
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="eyebrow mb-2">Wrong card? Search</div>
      <form
        className="relative"
        onSubmit={async (e) => {
          e.preventDefault()
          setSearching(true)
          const r = await lookupName(q).catch(() => null)
          setOnline(r?.card ?? null)
          setSearching(false)
        }}
      >
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3" />
        <input className="input pl-10" placeholder="Card name, then Enter to search all cards" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <ul className="mt-2">
        {[...(online ? [online] : []), ...results.filter((r) => r.id !== online?.id)].map((c) => (
          <li key={c.id}>
            <button className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 text-left" onClick={() => onPick(c, false)}>
              <CardImage card={c} small className="w-8" />
              <span className="text-sm flex-1 truncate">{c.name}</span>
              <span className="text-xs text-fg-3">{c.set.toUpperCase()}</span>
            </button>
          </li>
        ))}
        {searching && (
          <li className="text-sm text-fg-3 p-2 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Searching all cards…
          </li>
        )}
      </ul>
    </Sheet>
  )
}
