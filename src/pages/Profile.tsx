import { useMemo } from 'react'
import type { Color, Format, PlayStyle, Preferences } from '../lib/types'
import { clearCollection, resetDemo, setPrefs, useStore } from '../lib/store'
import { Link } from 'react-router-dom'
import { collectionStats } from '../lib/insights'
import { FORMAT_LABEL } from '../lib/analysis'
import { PageHeader, Pip, cx, eur, int, toast } from '../components/ui'

const STYLES: [PlayStyle, string][] = [
  ['aggro', 'Aggro'], ['midrange', 'Midrange'], ['control', 'Control'], ['combo', 'Combo'],
  ['tribal', 'Tribal'], ['graveyard', 'Graveyard'], ['tokens', 'Go wide'], ['weird', 'Weird & janky'],
]
const FORMATS: Format[] = ['commander', 'modern', 'pioneer', 'standard', 'legacy', 'pauper']
const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G']
const COLOR_NAME: Record<Color, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }

export default function Profile() {
  const prefs = useStore((s) => s.prefs)
  const collection = useStore((s) => s.collection)
  const stats = useMemo(() => collectionStats(collection), [collection])
  const toggle = <K extends 'formats' | 'colors' | 'styles' | 'gameTypes'>(k: K, v: Preferences[K][number]) => {
    const arr = prefs[k] as string[]
    setPrefs({ [k]: arr.includes(v as string) ? arr.filter((x) => x !== v) : [...arr, v] } as Partial<Preferences>)
  }

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Profile" title={prefs.username} subtitle="Tell DeckFoundry how you like to play. Every recommendation adapts." />

      <div className="grid grid-cols-3 gap-3 mb-10">
        <div className="panel p-4">
          <div className="eyebrow mb-1">Cards</div>
          <div className="num text-xl font-semibold">{int(stats.total)}</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow mb-1">Unique</div>
          <div className="num text-xl font-semibold">{int(stats.unique)}</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow mb-1">Value</div>
          <div className="num text-xl font-semibold">{eur(stats.value, 0)}</div>
        </div>
      </div>

      <div className="space-y-8">
        <Field label="Name">
          <input className="input max-w-xs" value={prefs.username} onChange={(e) => setPrefs({ username: e.target.value || 'Planeswalker' })} />
        </Field>

        <Field label="What do you play?">
          {(['commander', 'casual', 'constructed'] as const).map((g) => (
            <button key={g} className="chip capitalize" data-on={prefs.gameTypes.includes(g)} onClick={() => toggle('gameTypes', g)}>
              {g}
            </button>
          ))}
        </Field>

        <Field label="Favourite formats">
          {FORMATS.map((f) => (
            <button key={f} className="chip" data-on={prefs.formats.includes(f)} onClick={() => toggle('formats', f)}>
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </Field>

        <Field label="Competition level">
          {(['casual', 'balanced', 'competitive'] as const).map((c) => (
            <button key={c} className="chip capitalize" data-on={prefs.competition === c} onClick={() => setPrefs({ competition: c })}>
              {c}
            </button>
          ))}
        </Field>

        <Field label={`Budget to complete a deck · ${eur(prefs.budget, 0)}`}>
          <input type="range" min={0} max={200} step={5} value={prefs.budget} onChange={(e) => setPrefs({ budget: +e.target.value })} className="w-full max-w-md accent-[#e7c67f]" />
        </Field>

        <Field label="Favourite colours">
          {COLORS.map((c) => (
            <button key={c} className="chip" data-on={prefs.colors.includes(c)} onClick={() => toggle('colors', c)}>
              <Pip c={c} size={16} /> {COLOR_NAME[c]}
            </button>
          ))}
        </Field>

        <Field label="Play styles">
          {STYLES.map(([s, label]) => (
            <button key={s} className="chip" data-on={prefs.styles.includes(s)} onClick={() => toggle('styles', s)}>
              {label}
            </button>
          ))}
        </Field>

        <Field label="Known lists or original ideas?">
          <div className="w-full max-w-md">
            <input type="range" min={0} max={100} value={prefs.novelty} onChange={(e) => setPrefs({ novelty: +e.target.value })} className="w-full accent-[#a78bfa]" />
            <div className="flex justify-between text-xs text-fg-3 mt-1">
              <span className={cx(prefs.novelty < 40 && 'text-fg')}>Proven decks</span>
              <span className={cx(prefs.novelty > 60 && 'text-disc')}>Original experiments</span>
            </div>
          </div>
        </Field>

        <div className="pt-6 border-t hairline">
          <div className="eyebrow mb-2">Your data</div>
          <p className="text-sm text-fg-3 mb-3">Your collection and decks are stored in this browser.</p>
          <div className="flex flex-wrap gap-2">
          <Link to="/import" className="btn btn-primary">
            Import collection
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (confirm('Remove every card from your collection and start empty?')) {
                clearCollection()
                toast('Collection cleared')
              }
            }}
          >
            Start with an empty collection
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (confirm('Reset collection, saved decks and preferences to the demo data?')) {
                resetDemo()
                toast('Demo data restored')
              }
            }}
          >
            Load demo data
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-3">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}
