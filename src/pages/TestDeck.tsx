import { useEffect, useReducer, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bot, ChevronLeft, Heart, Minus, Plus, RotateCcw, Users } from 'lucide-react'
import { useDiscovery } from '../lib/discovery'
import { emptyTable, tableReducer } from '../lib/table'
import { TableView, Tool } from '../components/TableView'
import { cx } from '../components/ui'

export default function TestDeck() {
  const { id } = useParams()
  const disc = useDiscovery()
  const deck = disc.byId.get(id ?? '')?.deck
  const startLife = deck?.commander ? 40 : 20
  const [state, dispatch] = useReducer(tableReducer, emptyTable(startLife))
  const [turn, setTurn] = useState(1)
  const [oppLife, setOppLife] = useState(startLife)

  const reset = () => {
    if (!deck) return
    dispatch({ t: 'deal', deck, life: startLife })
    setOppLife(startLife)
    setTurn(1)
  }
  useEffect(reset, [deck])

  if (!deck) return <div className="p-10 text-center text-fg-3">Deck not found.</div>

  const library = state.cards.filter((c) => c.zone === 'library').length
  const header = (
    <div className="flex items-center gap-2 px-3 md:px-5 pt-[max(10px,env(safe-area-inset-top))] pb-2 border-b hairline bg-ink-900/60 backdrop-blur-xl">
      <Link to={`/deck/${deck.id}`} className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center" aria-label="Back">
        <ChevronLeft size={20} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate">{deck.name}</div>
        <div className="text-[11px] text-fg-3 num">
          Turn {turn} · Library {library}
        </div>
      </div>
      <Life value={state.life} mine onChange={(d) => dispatch({ t: 'life', delta: d })} />
      <Life value={oppLife} onChange={(d) => setOppLife((v) => v + d)} />
    </div>
  )

  return (
    <TableView
      state={state}
      dispatch={dispatch}
      deck={deck}
      header={header}
      tools={
        <>
          <Tool
            onClick={() => {
              dispatch({ t: 'untapAll' })
              dispatch({ t: 'draw', n: 1 })
              setTurn((t) => t + 1)
            }}
            disabled={state.phase !== 'play'}
          >
            Next turn
          </Tool>
          <Tool onClick={reset}>
            <RotateCcw size={13} />
          </Tool>
          <Link to={`/deck/${deck.id}/bot`} className="chip h-8 px-3 text-xs shrink-0 text-gold border-gold/40">
            <Bot size={13} /> vs bot
          </Link>
          <Link to={`/play?deck=${deck.id}`} className="chip h-8 px-3 text-xs shrink-0 text-gold border-gold/40">
            <Users size={13} /> Play online
          </Link>
        </>
      }
    />
  )
}

function Life({ value, onChange, mine }: { value: number; onChange: (d: number) => void; mine?: boolean }) {
  return (
    <div className={cx('flex items-center rounded-full border px-1 h-9', mine ? 'border-own/25 bg-own/5' : 'border-white/10')}>
      <button className="w-7 h-7 flex items-center justify-center text-fg-3" onClick={() => onChange(-1)} aria-label="Lose life">
        <Minus size={13} />
      </button>
      <span className="num text-sm font-semibold w-7 text-center flex items-center gap-0.5 justify-center">
        {mine && <Heart size={10} className="text-own" />}
        {value}
      </span>
      <button className="w-7 h-7 flex items-center justify-center text-fg-3" onClick={() => onChange(1)} aria-label="Gain life">
        <Plus size={13} />
      </button>
    </div>
  )
}
