import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Deck } from '../types'
import { getCard, isLand } from '../cardDb'
import { shuffle } from '../random'
import { emptyTable, isDead, tableReducer, zoneOf, type Inst, type TableAction, type TableState, type Zone } from '../table'
import { connect, type Transport } from './transport'
import type { GameInfo, LogEntry, Message, PresenceInfo, PubCard, PublicState } from './protocol'

// One online room. Presence says who's here; every player broadcasts a public
// snapshot of their own table; turn order, wins and new games are agreed by
// deterministic rules every client applies to the same messages.

// crypto.randomUUID only exists on https/localhost; phones on the LAN open the app over plain http
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

export function playerId(): string {
  try {
    // Per tab (sessionStorage): survives a refresh, and two tabs are two players
    let id = sessionStorage.getItem('deckfoundry:player')
    if (!id) {
      id = uuid()
      sessionStorage.setItem('deckfoundry:player', id)
    }
    return id
  } catch {
    return uuid()
  }
}

export const newRoomCode = () =>
  Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('')

const pub = (c: Inst): PubCard => ({ u: c.uid, n: c.card.name, i: c.card.imageSmall ?? c.card.image, ...(c.tapped ? { t: true } : {}), ...(isLand(c.card) ? { l: true } : {}) })
function snapshot(id: string, s: TableState): PublicState {
  const z = (k: Zone) => zoneOf(s, k).map(pub)
  return {
    id,
    life: s.life,
    poison: s.poison,
    cmdDamage: s.cmdDamage,
    hand: zoneOf(s, 'hand').length,
    library: zoneOf(s, 'library').length,
    mulligans: s.mulligans,
    cmdTax: (s.cmdCasts ?? 0) * 2,
    phase: s.phase,
    battlefield: z('battlefield'),
    graveyard: z('graveyard'),
    exile: z('exile'),
    command: z('command'),
  }
}

// ---- my table survives a refresh (sessionStorage) -------------------------------------------
type Saved = { game: number; s: Omit<TableState, 'cards'> & { cards: [number, string, Zone, boolean][] } }
const saveKey = (room: string) => `deckfoundry:table:${room}`
function saveTable(room: string, game: number, s: TableState) {
  try {
    const data: Saved = { game, s: { ...s, cards: s.cards.map((c) => [c.uid, c.card.id, c.zone, c.tapped]) } }
    sessionStorage.setItem(saveKey(room), JSON.stringify(data))
  } catch {
    /* ignore */
  }
}
function loadTable(room: string): { game: number; s: TableState } | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(saveKey(room)) ?? 'null') as Saved | null
    if (!d) return null
    const cards = d.s.cards.flatMap(([uid, id, zone, tapped]) => {
      const card = getCard(id)
      return card ? [{ uid, card, zone, tapped }] : []
    })
    return { game: d.game, s: { ...d.s, cards } }
  } catch {
    return null
  }
}

export interface RoomOptions {
  code: string
  name: string
  deck: Deck | undefined
  create?: { size: 2 | 4; life: number; format?: 'commander' | 'constructed' } // set when this player created the room
}

export function useRoom({ code, name, deck, create }: RoomOptions) {
  const myId = useMemo(playerId, [])
  const restored = useMemo(() => loadTable(code), [code])
  const [table, dispatch] = useReducer(tableReducer, restored?.s ?? emptyTable())
  const [players, setPlayers] = useState<PresenceInfo[]>([])
  const [status, setStatus] = useState<'connecting' | 'online' | 'error'>('connecting')
  const [game, setGame] = useState<GameInfo | null>(null)
  const [score, setScore] = useState<Record<string, number>>({})
  const [others, setOthers] = useState<Record<string, PublicState>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const [lastRoll, setLastRoll] = useState<{ who: string; label: string; value: string; k: number } | null>(null)
  const [ready, setReady] = useState(false)
  const transport = useRef<Transport | null>(null)
  const joinedAt = useMemo(() => {
    const k = `deckfoundry:joined:${code}`
    const v = Number(sessionStorage.getItem(k)) || Date.now()
    sessionStorage.setItem(k, String(v))
    return v
  }, [code])

  // Latest values for message handlers
  const ref = useRef({ table, game, score, deck, players, startLife: 20 })

  const me: PresenceInfo = useMemo(
    () => ({ id: myId, name, deckName: deck?.name ?? '', colors: deck?.colors ?? [], ready: ready && !!deck, host: !!create, joinedAt,
      ...(deck?.commander ? { commander: { name: deck.commander.name, image: deck.commander.imageSmall ?? deck.commander.image } } : {}),
      ...(create ? { size: create.size, life: create.life, format: create.format ?? (create.life >= 40 ? 'commander' : 'constructed') } : {}) }),
    [myId, name, deck, ready, create, joinedAt],
  )

  const nameOf = useCallback((id: string) => ref.current.players.find((p) => p.id === id)?.name ?? (id === myId ? name : 'Someone'), [myId, name])
  const addLog = useCallback((who: string, text: string) => setLog((l) => [...l.slice(-99), { at: Date.now(), who, text }]), [])

  // Seats, host and room settings, derived from presence
  const seated = useMemo(() => [...players].sort((a, b) => a.joinedAt - b.joinedAt), [players])
  const hostInfo = seated.find((p) => p.host) ?? seated[0]
  const size = hostInfo?.size ?? 2
  const startLife = hostInfo?.life ?? 20
  const format: 'commander' | 'constructed' = hostInfo?.format ?? (startLife >= 40 ? 'commander' : 'constructed')
  const iAmHost = hostInfo?.id === myId
  ref.current = { table, game, score, deck, players, startLife }
  const mySeat = seated.findIndex((p) => p.id === myId)
  const full = mySeat >= size

  const send = useCallback((m: Message) => transport.current?.send(m), [])

  // ---- connection -------------------------------------------------------------------------------
  useEffect(() => {
    const t = connect(code, me)
    transport.current = t
    t.onStatus(setStatus)
    t.onPresence(setPlayers)
    t.onMessage((m) => handle(m))
    t.send({ t: 'hello', from: myId })
    return () => t.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])
  useEffect(() => {
    transport.current?.track(me)
  }, [me])
  // Ask again once online (the first hello may go out before the channel is subscribed)
  useEffect(() => {
    if (status === 'online') send({ t: 'hello', from: myId })
  }, [status, send, myId])

  function handle(m: Message) {
    const { game, score, table } = ref.current
    switch (m.t) {
      case 'hello':
        if (game) send({ t: 'state', from: myId, s: snapshot(myId, table) })
        // The earliest seated player answers with the game so latecomers catch up
        if ([...ref.current.players].sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id === myId || ref.current.players.find((p) => p.id === myId)?.host)
          send({ t: 'sync', from: myId, game, score })
        break
      case 'state':
        setOthers((o) => ({ ...o, [m.from]: m.s }))
        break
      case 'sync':
        if (m.game && (!game || m.game.no > game.no || (m.game.no === game.no && m.game.turn > game.turn))) {
          setGame(m.game)
          setScore(m.score)
          // No saved table for this game (new device or cleared storage): deal a fresh one
          if ((!restored || restored.game !== m.game.no) && m.game.order.includes(myId) && ref.current.deck)
            dispatch({ t: 'deal', deck: ref.current.deck, life: ref.current.startLife })
        }
        break
      case 'start':
        beginGame(m.game, m.score)
        addLog(m.from, `started game ${m.game.no} — ${nameOf(m.game.active)} goes first`)
        break
      case 'pass':
        if (!game || m.from !== game.active) return
        updateGame({ ...game, active: m.active, turn: m.turn })
        if (m.active === myId) {
          dispatch({ t: 'untapAll' })
          dispatch({ t: 'draw', n: 1 })
        }
        addLog(m.from, `passed the turn to ${nameOf(m.active)}`)
        break
      case 'lost':
        markLost(m.from, m.game)
        break
      case 'log':
        addLog(m.from, m.text)
        break
      case 'roll':
        addLog(m.from, `rolled ${m.label}: ${m.value}`)
        setLastRoll({ who: m.from, label: m.label, value: m.value, k: Date.now() })
        break
    }
  }

  // Update the ref right away so a second message arriving before re-render sees it
  function updateGame(g: GameInfo) {
    ref.current.game = g
    setGame(g)
  }

  function beginGame(g: GameInfo, sc: Record<string, number>) {
    updateGame(g)
    setScore(sc)
    setOthers({})
    if (ref.current.deck && g.order.includes(myId)) dispatch({ t: 'deal', deck: ref.current.deck, life: ref.current.startLife })
  }

  function markLost(who: string, gameNo: number) {
    const g = ref.current.game
    if (!g || g.no !== gameNo || g.lost.includes(who)) return
    const lost = [...g.lost, who]
    const alive = g.order.filter((id) => !lost.includes(id))
    const next: GameInfo = { ...g, lost }
    if (alive.length === 1 && !g.winner) {
      next.winner = alive[0]
      setScore((sc) => ({ ...sc, [alive[0]]: (sc[alive[0]] ?? 0) + 1 }))
    }
    // If the eliminated player was active, the turn moves to the next player still in
    if (g.active === who && alive.length > 1) {
      const i = g.order.indexOf(who)
      for (let k = 1; k <= g.order.length; k++) {
        const cand = g.order[(i + k) % g.order.length]
        if (!lost.includes(cand)) {
          next.active = cand
          break
        }
      }
    }
    updateGame(next)
    addLog(who, 'is out of the game')
  }

  // ---- broadcast my table (debounced) and keep it across refreshes ------------------------------------
  useEffect(() => {
    if (!game) return
    saveTable(code, game.no, table)
    const t = setTimeout(() => send({ t: 'state', from: myId, s: snapshot(myId, table) }), 120)
    return () => clearTimeout(t)
  }, [table, game, code, send, myId])

  // ---- actions -------------------------------------------------------------------------------------------
  const act = useCallback((a: TableAction) => dispatch(a), [])
  const say = useCallback(
    (text: string) => {
      addLog(myId, text)
      send({ t: 'log', from: myId, text })
    },
    [addLog, send, myId],
  )

  const start = useCallback(() => {
    const ids = seated.slice(0, size).filter((p) => p.ready).map((p) => p.id)
    const prev = ref.current.game
    let order: string[]
    if (!prev) order = shuffle(ids)
    else {
      // Next game: the previous loser starts (2 players), otherwise the next seat
      const kept = prev.order.filter((id) => ids.includes(id))
      const loser = prev.order.find((id) => id !== prev.winner && prev.lost.includes(id))
      const startIdx = ids.length === 2 && loser ? kept.indexOf(loser) : (kept.indexOf(prev.order[0]) + 1) % kept.length
      order = [...kept.slice(startIdx), ...kept.slice(0, startIdx), ...ids.filter((id) => !kept.includes(id))]
    }
    const g: GameInfo = { no: (prev?.no ?? 0) + 1, order, active: order[0], turn: 1, lost: [] }
    send({ t: 'start', from: myId, game: g, score: ref.current.score })
    beginGame(g, ref.current.score)
    addLog(myId, `started game ${g.no} — ${nameOf(g.active)} goes first`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seated, size, send, myId])

  const pass = useCallback(() => {
    const g = ref.current.game
    if (!g || g.active !== myId || g.winner) return
    const i = g.order.indexOf(myId)
    let next = myId
    for (let k = 1; k <= g.order.length; k++) {
      const cand = g.order[(i + k) % g.order.length]
      if (!g.lost.includes(cand)) {
        next = cand
        break
      }
    }
    const turn = g.turn + 1
    send({ t: 'pass', from: myId, active: next, turn })
    updateGame({ ...g, active: next, turn })
    addLog(myId, `passed the turn to ${nameOf(next)}`)
  }, [send, myId, addLog, nameOf])

  const concede = useCallback(() => {
    const g = ref.current.game
    if (!g) return
    send({ t: 'lost', from: myId, game: g.no })
    markLost(myId, g.no)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, myId])

  const roll = useCallback(
    (label: string, value: string) => {
      send({ t: 'roll', from: myId, label, value })
      addLog(myId, `rolled ${label}: ${value}`)
    },
    [send, myId, addLog],
  )

  return {
    myId,
    status,
    transportKind: transport.current?.kind,
    players: seated,
    size,
    startLife,
    format,
    iAmHost,
    full,
    game,
    score,
    others,
    log,
    lastRoll,
    table,
    dispatch: act,
    ready,
    setReady,
    start,
    pass,
    concede,
    say,
    roll,
    nameOf,
    dead: !!game && !game.winner && isDead(table) && !game.lost.includes(myId),
    out: !!game && game.lost.includes(myId),
  }
}

export type Room = ReturnType<typeof useRoom>
