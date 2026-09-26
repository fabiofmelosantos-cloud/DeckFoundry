import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import type { Message, PresenceInfo } from './protocol'

// Realtime transport. Online rooms use Supabase Realtime (Broadcast for game
// messages, Presence for who's in the room) — no database tables needed.
// Without Supabase keys the app falls back to a local transport that only links
// tabs of the same browser, which is enough to try things out.

export interface Transport {
  kind: 'supabase' | 'local'
  send(msg: Message): void
  track(me: PresenceInfo): void
  onMessage(cb: (msg: Message) => void): void
  onPresence(cb: (players: PresenceInfo[]) => void): void
  onStatus(cb: (status: 'connecting' | 'online' | 'error') => void): void
  close(): void
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const onlineAvailable = !!(URL && KEY)

let client: ReturnType<typeof createClient> | null = null

export function connect(room: string, me: PresenceInfo): Transport {
  return onlineAvailable ? supabaseTransport(room, me) : localTransport(room, me)
}

function supabaseTransport(room: string, me: PresenceInfo): Transport {
  client ??= createClient(URL!, KEY!, { auth: { persistSession: false } })
  const msgCbs: ((m: Message) => void)[] = []
  const presCbs: ((p: PresenceInfo[]) => void)[] = []
  const statusCbs: ((s: 'connecting' | 'online' | 'error') => void)[] = []
  let current = me
  const ch: RealtimeChannel = client.channel(`deckfoundry:${room}`, { config: { broadcast: { self: false }, presence: { key: me.id } } })
  ch.on('broadcast', { event: 'msg' }, ({ payload }) => msgCbs.forEach((cb) => cb(payload as Message)))
  ch.on('presence', { event: 'sync' }, () => {
    const players = Object.values(ch.presenceState<PresenceInfo>()).map((metas) => metas[0] as unknown as PresenceInfo)
    presCbs.forEach((cb) => cb(players))
  })
  statusCbs.forEach((cb) => cb('connecting'))
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      ch.track(current)
      statusCbs.forEach((cb) => cb('online'))
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') statusCbs.forEach((cb) => cb('error'))
  })
  return {
    kind: 'supabase',
    send: (msg) => void ch.send({ type: 'broadcast', event: 'msg', payload: msg }),
    track: (p) => {
      current = p
      void ch.track(p)
    },
    onMessage: (cb) => msgCbs.push(cb),
    onPresence: (cb) => presCbs.push(cb),
    onStatus: (cb) => statusCbs.push(cb),
    close: () => void client?.removeChannel(ch),
  }
}

/** Same-browser transport: BroadcastChannel + a heartbeat standing in for Presence. */
function localTransport(room: string, me: PresenceInfo): Transport {
  const bc = new BroadcastChannel(`deckfoundry:${room}`)
  const msgCbs: ((m: Message) => void)[] = []
  const presCbs: ((p: PresenceInfo[]) => void)[] = []
  const seen = new Map<string, { info: PresenceInfo; at: number }>()
  let current = me
  const emit = () => presCbs.forEach((cb) => cb([...seen.values()].map((v) => v.info)))
  const beat = () => {
    seen.set(current.id, { info: current, at: Date.now() })
    bc.postMessage({ kind: 'presence', info: current })
  }
  bc.onmessage = (e) => {
    const d = e.data
    if (d.kind === 'presence') {
      const isNew = !seen.has(d.info.id)
      seen.set(d.info.id, { info: d.info, at: Date.now() })
      if (isNew) beat() // let newcomers see us right away
      emit()
    } else if (d.kind === 'leave') {
      seen.delete(d.id)
      emit()
    } else if (d.kind === 'msg') msgCbs.forEach((cb) => cb(d.msg))
  }
  const timer = setInterval(() => {
    beat()
    const now = Date.now()
    let changed = false
    for (const [id, v] of seen) if (id !== current.id && now - v.at > 6000) changed = seen.delete(id) || changed
    if (changed) emit()
  }, 2000)
  setTimeout(() => {
    beat()
    emit()
  }, 0)
  return {
    kind: 'local',
    send: (msg) => bc.postMessage({ kind: 'msg', msg }),
    track: (p) => {
      current = p
      beat()
      emit()
    },
    onMessage: (cb) => msgCbs.push(cb),
    onPresence: (cb) => presCbs.push(cb),
    onStatus: (cb) => setTimeout(() => cb('online'), 0),
    close: () => {
      clearInterval(timer)
      bc.postMessage({ kind: 'leave', id: current.id })
      bc.close()
    },
  }
}
