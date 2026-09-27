import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Check, ChevronLeft, Copy, Crown, Flag, Hand, Heart, Layers, Loader2, Minus, Mountain, Plus, ScrollText, Skull, Trophy, Wifi, WifiOff } from 'lucide-react'
import type { Deck } from '../lib/types'
import { useDiscovery } from '../lib/discovery'
import { isCommanderDeck, withCommander } from '../lib/table'
import { useStore } from '../lib/store'
import { useRoom, type Room } from '../lib/multiplayer/useRoom'
import type { PresenceInfo, PubCard, PublicState } from '../lib/multiplayer/protocol'
import { TableView, Tool } from '../components/TableView'
import { ManaPips, PageHeader, Sheet, cx, toast } from '../components/ui'

export default function PlayRoom() {
  const { code = '' } = useParams()
  const [params] = useSearchParams()
  const disc = useDiscovery()
  const name = useStore((s) => s.prefs.username)
  const base = disc.byId.get(params.get('deck') ?? '')?.deck
  const cmd = params.get('cmd')
  // A commander picked in the lobby for a 100-card list that didn't mark one
  const deck = useMemo(() => (base && cmd && !base.commander ? withCommander(base, cmd) : base), [base, cmd])
  const create = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`deckfoundry:create:${code}`) ?? 'null') ?? undefined
    } catch {
      return undefined
    }
  }, [code])

  if (!deck)
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-fg-2 mb-4">Pick a deck to join room {code}.</p>
        <Link to={`/play?room=${code}`} className="btn btn-primary">
          Choose a deck
        </Link>
      </div>
    )
  if (isCommanderDeck(deck) && !deck.commander)
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-fg-2 mb-4">{deck.name} has 100 cards — choose its commander before joining room {code}.</p>
        <Link to={`/play?room=${code}&deck=${deck.id}`} className="btn btn-primary">
          Choose commander
        </Link>
      </div>
    )
  return <RoomScreen code={code} name={name} deck={deck} create={create} />
}

function RoomScreen({ code, name, deck, create }: { code: string; name: string; deck: Deck; create?: { size: 2 | 4; life: number; format?: 'commander' | 'constructed' } }) {
  const room = useRoom({ code, name, deck, create })
  const inGame = !!room.game && room.game.order.includes(room.myId)

  useEffect(() => {
    if (room.lastRoll && room.lastRoll.who !== room.myId) toast(`${room.nameOf(room.lastRoll.who)} rolled ${room.lastRoll.label}: ${room.lastRoll.value}`)
  }, [room.lastRoll?.k])

  if (room.full && !inGame)
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <h1 className="display text-4xl mb-2">Room {code} is full</h1>
        <p className="text-fg-3 mb-6">All {room.size} seats are taken.</p>
        <Link to="/play" className="btn btn-primary">
          Back to lobby
        </Link>
      </div>
    )
  if (!inGame) return <WaitingRoom room={room} code={code} deckName={deck.name} />
  return <Game room={room} code={code} deck={deck} />
}

// ---- waiting room ----------------------------------------------------------------------------------
function WaitingRoom({ room, code, deckName }: { room: Room; code: string; deckName: string }) {
  const nav = useNavigate()
  const link = `${location.origin}/play/${code}`
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: '#eceae4', light: '#00000000' } }).then(setQr)
  }, [link])
  const seats = Array.from({ length: room.size }, (_, i) => room.players[i])
  const readyCount = room.players.slice(0, room.size).filter((p) => p.ready).length
  const between = !!room.game // a series is running but I'm not seated in the current game

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={`${room.format === 'commander' ? 'Commander' : 'Constructed'} · ${room.size} players · ${room.startLife} life`}
        title={
          <span className="font-mono tracking-[0.2em]">
            {code}
          </span>
        }
        subtitle="Share the code, link or QR. Everyone picks a deck and taps Ready."
        action={<ConnectionBadge room={room} />}
      />
      <div className="grid md:grid-cols-[1fr_260px] gap-4">
        <div className="panel p-5">
          <div className="eyebrow mb-3">Seats</div>
          <ul className="space-y-2">
            {seats.map((p, i) => (
              <li key={i} className={cx('flex items-center gap-3 rounded-2xl border px-4 py-3', p ? 'border-white/10' : 'border-dashed border-white/[.08]')}>
                <span className="num text-fg-3 w-4">{i + 1}</span>
                {p ? (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium flex items-center gap-2">
                        {p.name}
                        {p.id === room.myId && <span className="text-xs text-fg-3">(you)</span>}
                        {p.host && <Crown size={13} className="text-gold" />}
                      </div>
                      <div className="text-xs text-fg-3 flex items-center gap-1.5 truncate">
                        <ManaPips colors={p.colors} size={11} /> {p.deckName || 'choosing a deck…'}
                        {p.commander && (
                          <span className="inline-flex items-center gap-1 text-gold ml-1">
                            <Crown size={10} /> {p.commander.name.split(',')[0]}
                          </span>
                        )}
                      </div>
                    </div>
                    {room.score[p.id] ? <span className="text-xs text-gold num">{room.score[p.id]} win{room.score[p.id] > 1 ? 's' : ''}</span> : null}
                    <span className={cx('text-xs px-2 h-6 rounded-full inline-flex items-center border', p.ready ? 'text-own border-own/30 bg-own/10' : 'text-fg-3 border-white/10')}>{p.ready ? 'Ready' : 'Not ready'}</span>
                  </>
                ) : (
                  <span className="text-sm text-fg-3">Waiting for a player…</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <span className="text-sm text-fg-3 flex-1">
              Playing <b className="text-fg">{deckName}</b> ·{' '}
              <button className="underline hover:text-fg" onClick={() => nav(`/play?deck=`)}>
                change
              </button>
            </span>
            <button className={cx('btn', room.ready ? 'btn-ghost' : 'btn-primary')} onClick={() => room.setReady(!room.ready)}>
              {room.ready ? 'Not ready' : (
                <>
                  <Check size={16} /> Ready
                </>
              )}
            </button>
            {room.iAmHost && (
              <button className="btn btn-primary" disabled={readyCount < 2} onClick={room.start}>
                {between ? 'Start next game' : `Start game${readyCount >= 2 ? ` (${readyCount})` : ''}`}
              </button>
            )}
          </div>
          {!room.iAmHost && <p className="text-xs text-fg-3 mt-3">The host starts the game once at least two players are ready.</p>}
        </div>
        <div className="panel p-5 flex flex-col items-center text-center">
          {qr ? <img src={qr} alt={`QR code for room ${code}`} className="w-44 h-44 mb-3" /> : <div className="w-44 h-44 mb-3 shimmer rounded-xl" />}
          <button
            className="btn btn-ghost btn-sm w-full"
            onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Invite link copied'), () => toast(link))}
          >
            <Copy size={14} /> Copy invite link
          </button>
          {room.transportKind === 'local' && <p className="text-[11px] text-need mt-3">Local test mode: only tabs of this browser can join.</p>}
        </div>
      </div>
    </div>
  )
}

function ConnectionBadge({ room }: { room: Room }) {
  const online = room.status === 'online'
  return (
    <span className={cx('inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs', online ? 'text-own border-own/30' : room.status === 'error' ? 'text-need border-need/30' : 'text-fg-3 border-white/10')}>
      {online ? <Wifi size={13} /> : room.status === 'error' ? <WifiOff size={13} /> : <Loader2 size={13} className="animate-spin" />}
      {online ? (room.transportKind === 'local' ? 'Local' : 'Online') : room.status === 'error' ? 'Connection problem' : 'Connecting'}
    </span>
  )
}

// ---- game --------------------------------------------------------------------------------------------------
function Game({ room, code, deck }: { room: Room; code: string; deck: Deck }) {
  const g = room.game!
  const [logOpen, setLogOpen] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const myTurn = g.active === room.myId && !g.winner
  const opponents = g.order.filter((id) => id !== room.myId)
  const player = (id: string) => room.players.find((p) => p.id === id)
  const last = room.log[room.log.length - 1]
  const scoreLine = g.order.map((id) => `${id === room.myId ? 'You' : room.nameOf(id)} ${room.score[id] ?? 0}`).join(' · ')

  const header = (
    <div className="pt-[max(8px,env(safe-area-inset-top))] border-b hairline bg-ink-900/70 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-3 md:px-5 pb-2">
        <Link to="/play" className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center" aria-label="Leave room">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className={cx('text-sm font-semibold truncate', myTurn && 'text-gold')}>{g.winner ? 'Game over' : myTurn ? 'Your turn' : `${room.nameOf(g.active)}'s turn`}</div>
          <div className="text-[11px] text-fg-3 truncate num">
            <span className="font-mono">{code}</span> · {room.format === 'commander' ? 'Commander' : 'Constructed'} · Game {g.no} · Turn {g.turn} · {scoreLine}
          </div>
        </div>
        <button className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-fg-2" onClick={() => setLogOpen(true)} aria-label="Game log">
          <ScrollText size={18} />
        </button>
        <div className="flex items-center rounded-full border border-own/25 bg-own/5 px-1 h-9">
          <button className="w-7 h-7 flex items-center justify-center text-fg-3" onClick={() => room.dispatch({ t: 'life', delta: -1 })} aria-label="Lose life">
            <Minus size={13} />
          </button>
          <span className="num text-sm font-semibold w-8 text-center flex items-center gap-0.5 justify-center">
            <Heart size={10} className="text-own" />
            {room.table.life}
          </span>
          <button className="w-7 h-7 flex items-center justify-center text-fg-3" onClick={() => room.dispatch({ t: 'life', delta: 1 })} aria-label="Gain life">
            <Plus size={13} />
          </button>
        </div>
      </div>
      {last && (
        <div className="px-4 pb-1.5 text-[11px] text-fg-3 truncate">
          <b className="text-fg-2">{last.who === room.myId ? 'You' : room.nameOf(last.who)}</b> {last.text}
        </div>
      )}
    </div>
  )

  const top = (
    <div className={cx('px-2 md:px-4 pt-2', opponents.length > 1 ? 'grid grid-cols-3 gap-2' : '')}>
      {opponents.map((id) => (
        <OpponentPanel key={id} id={id} info={player(id)} s={room.others[id]} active={g.active === id} out={g.lost.includes(id)} compact={opponents.length > 1} onOpen={() => setFocus(id)} />
      ))}
    </div>
  )

  return (
    <>
      <TableView
        state={room.table}
        dispatch={room.dispatch}
        deck={deck}
        compact
        header={header}
        top={top}
        onRoll={room.roll}
        onAction={room.say}
        tools={
          <>
            <Tool onClick={room.pass} disabled={!myTurn || room.table.phase !== 'play'} accent={myTurn}>
              Pass turn
            </Tool>
            <Tool onClick={() => confirm('Concede this game?') && room.concede()} disabled={room.out || !!g.winner}>
              <Flag size={13} /> Concede
            </Tool>
          </>
        }
      />

      {/* Game over / knocked out */}
      {(g.winner || room.dead) && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="panel p-7 max-w-sm w-full text-center" style={{ animation: 'pop .4s both' }}>
            {g.winner ? (
              <>
                <Trophy size={34} className="mx-auto text-gold mb-3" />
                <h2 className="display text-4xl mb-1">{g.winner === room.myId ? 'You win!' : `${room.nameOf(g.winner)} wins`}</h2>
                <p className="text-fg-3 text-sm mb-5">Game {g.no} · {scoreLine}</p>
                {room.iAmHost ? (
                  <button className="btn btn-primary w-full" onClick={room.start}>
                    Next game
                  </button>
                ) : (
                  <p className="text-sm text-fg-2">Waiting for the host to start the next game…</p>
                )}
                <Link to="/play" className="btn btn-ghost w-full mt-2">
                  Leave room
                </Link>
              </>
            ) : (
              <>
                <Skull size={32} className="mx-auto text-need mb-3" />
                <h2 className="display text-3xl mb-2">You're out</h2>
                <p className="text-sm text-fg-3 mb-5">
                  {room.table.life <= 0 ? `Your life is ${room.table.life}.` : room.table.poison >= 10 ? '10 poison counters.' : '21 commander damage from one opponent.'} Misclick? Adjust and keep playing.
                </p>
                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1" onClick={() => room.dispatch({ t: 'life', delta: 1 - Math.min(0, room.table.life) })}>
                    Undo
                  </button>
                  <button className="btn btn-primary flex-1" onClick={room.concede}>
                    I'm out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Game log">
        <ul className="space-y-2 text-sm">
          {[...room.log].reverse().map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-fg-3 num text-xs w-10 shrink-0 pt-0.5">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span>
                <b>{e.who === room.myId ? 'You' : room.nameOf(e.who)}</b> <span className="text-fg-2">{e.text}</span>
              </span>
            </li>
          ))}
          {room.log.length === 0 && <li className="text-fg-3">Nothing yet.</li>}
        </ul>
      </Sheet>

      <OpponentSheet room={room} id={focus} onClose={() => setFocus(null)} />
    </>
  )
}

function OpponentPanel({ id, info, s, active, out, compact, onOpen }: { id: string; info?: PresenceInfo; s?: PublicState; active: boolean; out: boolean; compact: boolean; onOpen: () => void }) {
  const board = s?.battlefield.filter((c) => !c.l) ?? []
  const lands = s?.battlefield.filter((c) => c.l).length ?? 0
  return (
    <button onClick={onOpen} className={cx('w-full text-left rounded-2xl border p-2.5 md:p-3 transition-colors bg-ink-850/80', active ? 'border-gold/50 shadow-[0_0_20px_-6px_rgb(231,198,127)]' : 'border-white/[.07]', out && 'opacity-40')} data-player={id}>
      <div className="flex items-center gap-2">
        {info?.commander?.image && (
          <div className="relative shrink-0" title={`Commander: ${info.commander.name}${s?.cmdTax ? ` (tax +${s.cmdTax})` : ''}`}>
            <img src={info.commander.image} alt={info.commander.name} className={cx('rounded-[4px] ring-1 ring-gold/60 object-cover', compact ? 'w-6 h-8' : 'w-8 h-11')} />
            {!!s?.cmdTax && <span className="absolute -bottom-1 -right-1 text-[8px] font-bold px-0.5 rounded bg-black text-gold">+{s.cmdTax}</span>}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs md:text-sm font-semibold truncate flex items-center gap-1">
            {out && <Skull size={11} className="text-need" />}
            {info?.name ?? 'Player'}
          </div>
          {!compact && <div className="text-[11px] text-fg-3 truncate">{info?.deckName}</div>}
        </div>
        <div className="num text-lg md:text-xl font-semibold flex items-center gap-1">
          <Heart size={11} className="text-need" />
          {s?.life ?? '–'}
        </div>
      </div>
      <div className="flex gap-2 text-[10px] md:text-[11px] text-fg-3 mt-1 num">
        <span className="inline-flex items-center gap-0.5" title="Cards in hand">
          <Hand size={10} /> {s?.hand ?? '–'}
        </span>
        <span className="inline-flex items-center gap-0.5" title="Library">
          <Layers size={10} /> {s?.library ?? '–'}
        </span>
        {lands > 0 && (
          <span className="inline-flex items-center gap-0.5" title="Lands">
            <Mountain size={10} /> {lands}
          </span>
        )}
        {!!s?.poison && (
          <span className="inline-flex items-center gap-0.5 text-own" title="Poison">
            <Skull size={10} /> {s.poison}
          </span>
        )}
        {s?.phase && s.phase !== 'play' && <span className="text-gold">mulligan…</span>}
      </div>
      {board.length > 0 && (
        <div className={cx('flex gap-1 mt-2 overflow-hidden', compact ? 'h-9' : 'h-14 md:h-20')}>
          {board.slice(0, compact ? 4 : 12).map((c) => (
            <MiniCard key={c.u} c={c} className={compact ? 'w-6' : 'w-10 md:w-14'} />
          ))}
          {board.length > (compact ? 4 : 12) && <span className="text-[10px] text-fg-3 self-center">+{board.length - (compact ? 4 : 12)}</span>}
        </div>
      )}
    </button>
  )
}

function MiniCard({ c, className }: { c: PubCard; className?: string }) {
  return (
    <div className={cx('card-img shrink-0 transition-transform', c.t && 'rotate-12 opacity-70', className)} title={c.n}>
      {c.i && <img src={c.i} alt={c.n} className="w-full h-full object-cover" loading="lazy" />}
    </div>
  )
}

function OpponentSheet({ room, id, onClose }: { room: Room; id: string | null; onClose: () => void }) {
  const s = id ? room.others[id] : undefined
  const zones: [string, PubCard[]][] = s
    ? [
        ['Battlefield', s.battlefield.filter((c) => !c.l)],
        ['Lands', s.battlefield.filter((c) => c.l)],
        ['Command zone', s.command],
        ['Graveyard', s.graveyard],
        ['Exile', s.exile],
      ]
    : []
  const cmd = id ? room.table.cmdDamage[id] ?? 0 : 0
  return (
    <Sheet open={!!id} onClose={onClose} title={id ? room.nameOf(id) : ''} wide>
      {!s ? (
        <p className="text-sm text-fg-3">Waiting for their table…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-4 text-sm num">
            <span>Life {s.life}</span>
            <span>Hand {s.hand}</span>
            <span>Library {s.library}</span>
            <span>Poison {s.poison}</span>
          </div>
          {s.command.length > 0 || room.table.cmdDamage[id!] != null ? (
            <div className="flex items-center gap-3 text-sm rounded-2xl border border-white/10 p-3">
              <Crown size={15} className="text-gold" />
              <span className="flex-1">Commander damage you've taken from {room.nameOf(id!)}</span>
              <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center" onClick={() => room.dispatch({ t: 'cmdDamage', from: id!, delta: -1 })} aria-label="Less">
                <Minus size={14} />
              </button>
              <span className="num w-6 text-center font-semibold">{cmd}</span>
              <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center" onClick={() => room.dispatch({ t: 'cmdDamage', from: id!, delta: 1 })} aria-label="More">
                <Plus size={14} />
              </button>
            </div>
          ) : null}
          {zones.map(([label, cards]) =>
            cards.length ? (
              <div key={label}>
                <div className="eyebrow mb-2">
                  {label} · {cards.length}
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {cards.map((c) => (
                    <MiniCard key={c.u} c={c} />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </Sheet>
  )
}
