import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Check, FileUp, Loader2, Upload } from 'lucide-react'
import type { Deck, DeckCard } from '../lib/types'
import { parseImport, resolveLocal, resolveRemaining, SOURCES, type ParseResult, type Resolved, type Source } from '../lib/importers'
import { addToCollection, replaceCollection, saveDeck, useStore } from '../lib/store'
import { displayName, isLand, price } from '../lib/cardDb'
import { guildName, sortColors } from '../lib/analysis'
import { CardImage, PageHeader, StatusTag, cx, eur, int, toast } from '../components/ui'

type Step = 'input' | 'review' | 'done'

export default function Import() {
  const nav = useNavigate()
  const isDemo = useStore((s) => s.isDemo)
  const [source, setSource] = useState<Source>('arena')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [resolved, setResolved] = useState<Resolved[]>([])
  const [step, setStep] = useState<Step>('input')
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'add' | 'replace'>(isDemo ? 'replace' : 'add')
  const [asDeck, setAsDeck] = useState(false)
  const [deckName, setDeckName] = useState('')
  const [result, setResult] = useState<{ cards: number; value: number; missing: number; deckId?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const how = SOURCES.find((s) => s.id === source)!

  const readFile = (f: File) => {
    setFileName(f.name)
    f.text().then(setText)
    if (!deckName) setDeckName(f.name.replace(/\.[^.]+$/, ''))
  }

  const analyse = async () => {
    setError('')
    const p = parseImport(text)
    if (!p.rows.length) {
      setError("We couldn't find any cards in that. Check the format and try again.")
      return
    }
    setParsed(p)
    setAsDeck(p.looksLikeDeck)
    const local = resolveLocal(p.rows)
    setResolved(local)
    setStep('review')
    if (local.some((r) => !r.card)) {
      setBusy({ done: 0, total: local.filter((r) => !r.card).length })
      try {
        setResolved(await resolveRemaining(local, (done, total) => setBusy({ done, total })))
      } catch (e) {
        setError(`${(e as Error).message} Cards found locally can still be imported.`)
      } finally {
        setBusy(null)
      }
    }
  }

  const stats = useMemo(() => {
    const ok = resolved.filter((r) => r.card)
    return {
      rows: resolved.length,
      cards: ok.reduce((a, r) => a + r.row.qty, 0),
      value: ok.reduce((a, r) => a + price(r.card!, r.row.foil) * r.row.qty, 0),
      missing: resolved.filter((r) => !r.card),
      online: resolved.filter((r) => r.via === 'online').length,
    }
  }, [resolved])

  const confirm = () => {
    const ok = resolved.filter((r) => r.card)
    const items = ok.map((r) => ({ cardId: r.card!.id, qty: r.row.qty, foil: r.row.foil }))
    if (mode === 'replace') replaceCollection(items)
    else addToCollection(items)
    let deckId: string | undefined
    if (asDeck) {
      const deck = importedDeck(ok, deckName || fileName || 'Imported deck', parsed!)
      saveDeck(deck)
      deckId = deck.id
    }
    setResult({ cards: stats.cards, value: stats.value, missing: stats.missing.length, deckId })
    setStep('done')
    toast(<>Imported {int(stats.cards)} cards</>)
  }

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Import" title={<>Bring your <span className="italic text-gold">collection</span></>} subtitle="From MTG Arena, ManaBox, Moxfield, Deckbox, Archidekt, TCGplayer, Dragon Shield — or any CSV or text list." />

      {step === 'input' && (
        <div className="space-y-6">
          {isDemo && (
            <div className="flex items-start gap-3 rounded-2xl border border-disc/25 bg-disc/[.06] p-4 text-sm">
              <AlertTriangle size={17} className="text-disc shrink-0 mt-0.5" />
              <div>Your collection currently holds <b>demo cards</b>. Importing replaces them by default, so everything the app shows is based on cards you really own.</div>
            </div>
          )}
          <div>
            <div className="eyebrow mb-3">Where from?</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SOURCES.map((s) => (
                <button key={s.id} onClick={() => setSource(s.id)} className={cx('panel rounded-2xl px-4 py-3 text-left text-sm font-medium transition-colors', source === s.id ? 'border-gold/50 text-gold bg-gold/[.06]' : 'hover:border-white/15')}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-fg-3 mt-3">{how.how}</p>
          </div>

          <div
            className="panel p-4"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files[0]
              if (f) readFile(f)
            }}
          >
            <textarea
              className="input h-56 py-3 font-mono text-xs leading-relaxed resize-y"
              placeholder={source === 'arena' ? 'Deck\n4 Lightning Bolt (M11) 146\n4 Monastery Swiftspear (KTK) 118\n…' : source === 'text' ? '4 Lightning Bolt\n1x Sol Ring (C21) 263\n2 Llanowar Elves *F*' : 'Paste the CSV here, or drop the file on this box'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <input ref={fileRef} type="file" accept=".csv,.txt,.dec,.dek,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                <FileUp size={16} /> {fileName || 'Choose file'}
              </button>
              <span className="text-xs text-fg-3 flex-1">.csv or .txt — nothing leaves your browser except card lookups on Scryfall.</span>
              <button className="btn btn-primary" disabled={!text.trim()} onClick={analyse}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
            {error && <p className="text-need text-sm mt-3">{error}</p>}
          </div>
        </div>
      )}

      {step === 'review' && parsed && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Detected" value={SOURCES.find((s) => s.id === parsed.source)?.label ?? 'CSV'} />
            <Stat label="Cards" value={int(stats.cards)} />
            <Stat label="Value" value={eur(stats.value, 0)} />
            <Stat label="Not found" value={String(stats.missing.length)} tone={stats.missing.length ? 'need' : 'own'} />
          </div>

          {busy && (
            <div className="panel p-4 flex items-center gap-3 text-sm">
              <Loader2 size={16} className="animate-spin text-gold" />
              Looking up {busy.total} cards on Scryfall… <span className="num text-fg-3">{busy.done}/{busy.total}</span>
            </div>
          )}
          {error && <p className="text-need text-sm">{error}</p>}

          <div className="panel divide-y divide-white/5 max-h-[420px] overflow-y-auto">
            {resolved.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="num w-8 text-fg-3">{r.row.qty}×</span>
                {r.card ? <CardImage card={r.card} small className="w-8 shrink-0" /> : <div className="w-8 aspect-[488/680] rounded bg-white/5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className={cx('truncate', !r.card && 'text-fg-3 line-through')}>{r.card ? displayName(r.card) : r.row.name}</div>
                  <div className="text-xs text-fg-3 truncate">
                    {r.card ? r.card.setName : busy ? 'Looking up…' : `Line ${r.row.line} — no card with this name`}
                    {r.row.foil && ' · Foil'}
                    {r.row.section === 'commander' && ' · Commander'}
                    {r.row.section === 'sideboard' && ' · Sideboard'}
                  </div>
                </div>
                {r.card ? <StatusTag kind="own">{r.via === 'online' ? 'Found' : 'Matched'}</StatusTag> : !busy && <StatusTag kind="need">Not found</StatusTag>}
              </div>
            ))}
          </div>
          {parsed.skipped.length > 0 && (
            <p className="text-xs text-fg-3">
              Skipped {parsed.skipped.length} line{parsed.skipped.length > 1 ? 's' : ''} that didn't look like cards (e.g. “{parsed.skipped[0].slice(0, 60)}”).
            </p>
          )}

          <div className="panel p-5 space-y-4">
            <div>
              <div className="eyebrow mb-2">What should happen?</div>
              <div className="flex flex-wrap gap-2">
                <button className="chip h-10 px-4" data-on={mode === 'replace'} onClick={() => setMode('replace')}>
                  Replace my collection
                </button>
                <button className="chip h-10 px-4" data-on={mode === 'add'} onClick={() => setMode('add')}>
                  Add to my collection
                </button>
              </div>
              {mode === 'replace' && <p className="text-xs text-need mt-2">Your current collection{isDemo ? ' (demo data)' : ''} and AI-generated decks will be replaced.</p>}
            </div>
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={asDeck} onChange={(e) => setAsDeck(e.target.checked)} className="w-4 h-4 accent-[#e7c67f]" />
              Also save this list as a deck
            </label>
            {asDeck && <input className="input max-w-sm" placeholder="Deck name" value={deckName} onChange={(e) => setDeckName(e.target.value)} />}
            <div className="flex gap-2 pt-2">
              <button className="btn btn-ghost" onClick={() => setStep('input')}>
                Back
              </button>
              <button className="btn btn-primary" disabled={!!busy || stats.cards === 0} onClick={confirm}>
                <Upload size={16} /> Import {int(stats.cards)} cards
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="panel p-8 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-own/15 text-own flex items-center justify-center mb-5" style={{ animation: 'pop .5s both' }}>
            <Check size={30} />
          </div>
          <h2 className="display text-4xl mb-1">{int(result.cards)} cards imported</h2>
          <p className="text-fg-2 mb-2">
            Worth <span className="num text-fg">{eur(result.value)}</span>
          </p>
          {result.missing > 0 && <p className="text-sm text-need mb-2">{result.missing} lines couldn't be matched to a real card and were left out.</p>}
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            {result.deckId && (
              <Link to={`/deck/${result.deckId}`} className="btn btn-ghost">
                Open imported deck
              </Link>
            )}
            <button className="btn btn-primary" onClick={() => nav('/discover')}>
              Here's what you can build <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'own' | 'need' }) {
  return (
    <div className="panel p-4 rounded-2xl">
      <div className="text-[11px] text-fg-3 uppercase tracking-wider">{label}</div>
      <div className={cx('num text-lg font-semibold truncate', tone === 'own' && 'text-own', tone === 'need' && 'text-need')}>{value}</div>
    </div>
  )
}

function importedDeck(ok: Resolved[], name: string, parsed: ParseResult): Deck {
  const main = ok.filter((r) => r.row.section !== 'sideboard')
  const cmdRow = main.find((r) => r.row.section === 'commander')
  const merged = new Map<string, DeckCard>()
  for (const r of main) {
    const e = merged.get(r.card!.name)
    if (e) e.qty += r.row.qty
    else merged.set(r.card!.name, { card: r.card!, qty: r.row.qty, commander: r.row.section === 'commander' || undefined })
  }
  const cards = [...merged.values()]
  const colors = sortColors(cmdRow ? cmdRow.card!.colorIdentity : cards.filter((c) => !isLand(c.card)).flatMap((c) => c.card.colors))
  const total = cards.reduce((a, c) => a + c.qty, 0)
  return {
    id: `imp-${Date.now().toString(36)}`,
    name,
    colors,
    format: cmdRow || parsed.hasCommander ? 'commander' : 'casual',
    mode: cmdRow ? 'commander' : 'kitchen',
    power: 'Casual',
    strategy: 'Imported list',
    tagline: `${guildName(colors)} list imported${parsed.source === 'arena' ? ' from MTG Arena' : ''}.`,
    description: `An imported ${total}-card ${guildName(colors)} list.`,
    cards,
    commander: cmdRow?.card ?? undefined,
    keyCards: cards.filter((c) => !isLand(c.card)).sort((a, b) => b.qty - a.qty || b.card.cmc - a.card.cmc).slice(0, 4).map((c) => c.card.name),
    winCondition: '',
    strengths: [],
    weaknesses: [],
    origin: 'imported',
  }
}
