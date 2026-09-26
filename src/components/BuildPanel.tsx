import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, Check, Loader2, Wand2 } from 'lucide-react'
import { generateFromPrompt, THINKING_STEPS } from '../lib/generate'
import { useStore } from '../lib/store'
import { collectionStats } from '../lib/insights'
import { cx, int } from './ui'

const EXAMPLES = [
  'Build me a Commander deck using only cards I own.',
  'Build me a competitive deck under €30.',
  'Build something around Blood Artist.',
  'Build me something weird.',
]

export function BuildPanel({ initial = '' }: { initial?: string }) {
  const nav = useNavigate()
  const collection = useStore((s) => s.collection)
  const [prompt, setPrompt] = useState(initial)
  const [step, setStep] = useState(-1)
  const [error, setError] = useState('')
  const unique = collectionStats(collection).unique

  useEffect(() => {
    if (step < 0) return
    if (step < THINKING_STEPS.length) {
      const t = setTimeout(() => setStep(step + 1), 320 + Math.random() * 260)
      return () => clearTimeout(t)
    }
    try {
      const deck = generateFromPrompt(prompt)
      nav(`/deck/${deck.id}?new=1`)
    } catch (e) {
      setError((e as Error).message)
      setStep(-1)
    }
  }, [step, prompt, nav])

  const go = (p = prompt) => {
    if (!p.trim()) return
    setPrompt(p)
    setError('')
    setStep(0)
  }
  const busy = step >= 0

  return (
    <div id="build" className="panel p-5 md:p-7 relative overflow-hidden scroll-mt-24">
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-disc/10 blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2 text-disc mb-2">
          <Wand2 size={16} />
          <span className="eyebrow text-disc">Build from my collection</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">What do you want to play?</h2>
        <p className="text-fg-3 text-sm mb-5">Every card comes from the card database, and cards you own always come first.</p>

        {!busy ? (
          <>
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault()
                go()
              }}
            >
              <textarea
                className="input h-auto min-h-[92px] py-3 pr-14 resize-none leading-relaxed"
                placeholder="e.g. A Golgari Commander deck around graveyard recursion…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    go()
                  }
                }}
              />
              <button type="submit" disabled={!prompt.trim()} className={cx('absolute right-3 bottom-3 w-10 h-10 rounded-full flex items-center justify-center transition', prompt.trim() ? 'btn-primary' : 'bg-white/5 text-fg-3')} aria-label="Build">
                <ArrowUp size={18} />
              </button>
            </form>
            <div className="flex gap-2 mt-3 flex-wrap">
              {EXAMPLES.map((e) => (
                <button key={e} className="chip text-left" onClick={() => go(e)}>
                  {e}
                </button>
              ))}
            </div>
            {error && <p className="text-need text-sm mt-3">{error}</p>}
          </>
        ) : (
          <div className="rounded-2xl bg-white/[.03] border border-white/5 p-5">
            <div className="text-sm text-fg-2 mb-4 italic">“{prompt}”</div>
            <ul className="space-y-2.5">
              {THINKING_STEPS.map((s, i) => (
                <li key={s} className={cx('flex items-center gap-3 text-sm transition-opacity', i > step && 'opacity-30')}>
                  {i < step ? <Check size={15} className="text-own" /> : i === step ? <Loader2 size={15} className="text-gold animate-spin" /> : <span className="w-[15px] h-[15px] rounded-full border border-white/20" />}
                  {i === 0 ? `${s} — ${int(unique)} unique cards` : s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
