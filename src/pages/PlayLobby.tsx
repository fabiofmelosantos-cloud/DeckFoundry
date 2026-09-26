import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Bot, Info, Plus, Users } from 'lucide-react'
import { useDiscovery } from '../lib/discovery'
import { setPrefs, useStore } from '../lib/store'
import { newRoomCode } from '../lib/multiplayer/useRoom'
import { onlineAvailable } from '../lib/multiplayer/transport'
import { ManaPips, PageHeader, cx } from '../components/ui'

export default function PlayLobby() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const disc = useDiscovery()
  const name = useStore((s) => s.prefs.username)
  const decks = useMemo(() => [...disc.saved, ...disc.all.filter((a) => !disc.savedIds.has(a.deck.id))].filter((a) => a.total >= 40), [disc])
  const [deckId, setDeckId] = useState(params.get('deck') ?? decks[0]?.deck.id ?? '')
  const deck = decks.find((a) => a.deck.id === deckId)?.deck
  const [size, setSize] = useState<2 | 4>(2)
  const [code, setCode] = useState('')
  const life = deck?.commander ? 40 : 20

  const create = () => {
    const c = newRoomCode()
    sessionStorage.setItem(`deckfoundry:create:${c}`, JSON.stringify({ size, life }))
    nav(`/play/${c}?deck=${deckId}`)
  }

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Play" title={<>Play with <span className="italic text-gold">friends</span></>} subtitle="Open a room for 2 or 4 players, share the code, and play one game or a whole series — each on your own phone." />

      {!onlineAvailable && (
        <div className="flex gap-3 rounded-2xl border border-need/25 bg-need/[.06] p-4 mb-6 text-sm">
          <Info size={17} className="text-need shrink-0 mt-0.5" />
          <div>
            <b>Online play isn't connected yet.</b> Rooms currently link only tabs in this browser — good for trying it out. To play across phones, add your Supabase project URL and anon key to <code className="text-fg">.env.local</code> (see README).
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="panel p-5 space-y-5">
          <label className="block">
            <span className="eyebrow">Your name</span>
            <input className="input mt-2 max-w-xs" value={name} onChange={(e) => setPrefs({ username: e.target.value || 'Planeswalker' })} />
          </label>
          <div>
            <div className="eyebrow mb-2">Your deck</div>
            <div className="grid sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {decks.map((a) => (
                <button key={a.deck.id} onClick={() => setDeckId(a.deck.id)} className={cx('flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors', deckId === a.deck.id ? 'border-gold/50 bg-gold/[.06]' : 'border-white/[.07] hover:border-white/15')}>
                  <ManaPips colors={a.deck.colors} size={14} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.deck.name}</div>
                    <div className="text-xs text-fg-3">
                      {a.deck.commander ? 'Commander' : `${a.total} cards`} · {a.pct}% owned
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {deck && (() => {
              const a = decks.find((x) => x.deck.id === deckId)!
              return a.pct < 100 ? <p className="text-xs text-fg-3 mt-2">You own {a.owned}/{a.total} — the rest plays as proxies.</p> : null
            })()}
          </div>
        </div>

        {deck && (
          <Link to={`/deck/${deck.id}/bot`} className="panel p-5 flex items-center gap-4 lift hover:border-white/15">
            <div className="w-11 h-11 rounded-2xl bg-disc/15 text-disc flex items-center justify-center">
              <Bot size={20} />
            </div>
            <div className="flex-1">
              <div className="font-semibold">Practice vs bot</div>
              <div className="text-sm text-fg-3">No friends online? Play {deck.name} against a computer opponent.</div>
            </div>
            <ArrowRight size={16} className="text-fg-3" />
          </Link>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="panel p-5">
            <div className="flex items-center gap-2 font-semibold mb-4">
              <Plus size={16} className="text-gold" /> Create a room
            </div>
            <div className="eyebrow mb-2">Players</div>
            <div className="flex gap-2 mb-4">
              {([2, 4] as const).map((n) => (
                <button key={n} className="chip h-10 px-4" data-on={size === n} onClick={() => setSize(n)}>
                  <Users size={14} /> {n} players
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-3 mb-4">Starting life {life}{deck?.commander ? ' (Commander)' : ''}.</p>
            <button className="btn btn-primary w-full" disabled={!deck} onClick={create}>
              Create room <ArrowRight size={16} />
            </button>
          </div>
          <div className="panel p-5">
            <div className="flex items-center gap-2 font-semibold mb-4">
              <ArrowRight size={16} className="text-gold" /> Join a room
            </div>
            <div className="eyebrow mb-2">Room code</div>
            <input
              className="input mb-4 uppercase tracking-[0.3em] font-mono text-lg"
              maxLength={5}
              placeholder="ABCDE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button className="btn btn-ghost w-full" disabled={code.length !== 5 || !deck} onClick={() => nav(`/play/${code}?deck=${deckId}`)}>
              Join
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
