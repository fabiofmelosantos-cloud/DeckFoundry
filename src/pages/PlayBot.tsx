import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bot, ChevronLeft, Dices, Hand, Heart, Layers, Minus, Plus, ScrollText, Shuffle, Swords, Trophy, Zap } from 'lucide-react'
import type { Deck } from '../lib/types'
import { useDiscovery } from '../lib/discovery'
import { displayName, isCreature, isLand } from '../lib/cardDb'
import {
  canAttack, canBlock, cast, declareAttack, draw, endTurn, kw, manaAvailable, manual, myKeep, myMulligan, newGame, parseCost, payment, playLand, power, resolveCombat, say, toughness,
  type GameState, type Manual, type Perm,
} from '../lib/bot/engine'
import { botBlocks, botTurn, type BotStep } from '../lib/bot/ai'
import { CardImage, ManaCost, ManaPips, Sheet, cx } from '../components/ui'

const BOT_DELAY = 650

export default function PlayBot() {
  const { id } = useParams()
  const disc = useDiscovery()
  const deck = disc.byId.get(id ?? '')?.deck
  const [opponent, setOpponent] = useState<Deck | null>(null)
  if (!deck) return <div className="p-10 text-center text-fg-3">Deck not found.</div>
  if (!opponent) return <ChooseOpponent deck={deck} onPick={setOpponent} />
  return <BotGame deck={deck} opponent={opponent} onChangeOpponent={() => setOpponent(null)} />
}

// ---- opponent picker ---------------------------------------------------------------------------
function ChooseOpponent({ deck, onPick }: { deck: Deck; onPick: (d: Deck) => void }) {
  const disc = useDiscovery()
  const options = disc.all.filter((a) => a.deck.id !== deck.id && !a.deck.commander === !deck.commander && a.total >= 40)
  return (
    <div className="max-w-3xl">
      <Link to={`/deck/${deck.id}`} className="inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg mb-6">
        <ChevronLeft size={15} /> {deck.name}
      </Link>
      <h1 className="display text-4xl md:text-5xl mb-2">
        Practice vs <span className="italic text-gold">bot</span>
      </h1>
      <p className="text-fg-2 mb-2">
        You play <b>{deck.name}</b>. Pick the deck the bot plays.
      </p>
      <p className="text-xs text-fg-3 mb-6 max-w-xl">
        The bot plays lands and spells, attacks and blocks sensibly, and understands simple effects (removal, burn, draw, tokens, lifegain). Combat is calculated for you. Special abilities on your own cards you apply by hand from the card menus.
      </p>
      <button className="btn btn-primary mb-5" onClick={() => onPick(options[Math.floor(Math.random() * options.length)].deck)} disabled={!options.length}>
        <Dices size={16} /> Random opponent
      </button>
      <div className="grid sm:grid-cols-2 gap-2">
        {options.map((a) => (
          <button key={a.deck.id} onClick={() => onPick(a.deck)} className="flex items-center gap-3 rounded-2xl border border-white/[.07] hover:border-white/15 px-4 py-3 text-left">
            <ManaPips colors={a.deck.colors} size={14} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{a.deck.name}</div>
              <div className="text-xs text-fg-3 truncate">
                {a.deck.strategy} · {a.deck.power}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---- the game ---------------------------------------------------------------------------------------
type Mode = { kind: 'idle' } | { kind: 'attack'; selected: number[] } | { kind: 'block'; attacker: number | null }

function BotGame({ deck, opponent, onChangeOpponent }: { deck: Deck; opponent: Deck; onChangeOpponent: () => void }) {
  const g = useRef<GameState>(newGame(deck, opponent, Math.random() < 0.5 ? 'me' : 'bot'))
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [menu, setMenu] = useState<{ kind: 'hand'; uid: number } | { kind: 'perm'; owner: 'me' | 'bot'; uid: number } | null>(null)
  const [bottomSel, setBottomSel] = useState<number[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [error, setError] = useState('')
  const [score, setScore] = useState({ me: 0, bot: 0 })
  const botRun = useRef<Generator<BotStep, void, void> | null>(null)
  const scored = useRef(false)
  const s = g.current

  const update = useCallback((fn: (g: GameState) => void | string | null) => {
    const res = fn(g.current)
    setError(typeof res === 'string' ? res : '')
    rerender()
  }, [])

  // ---- bot turn: step through the generator with a small delay per action
  const stepBot = useCallback(() => {
    const it = botRun.current
    if (!it) return
    const r = it.next()
    rerender()
    if (r.done) {
      botRun.current = null
      rerender()
      return
    }
    if (r.value.kind === 'await-blocks') {
      setMode({ kind: 'block', attacker: null })
      return
    }
    setTimeout(stepBot, BOT_DELAY)
  }, [])
  useEffect(() => {
    if (s.active === 'bot' && s.phase === 'main' && !botRun.current) {
      botRun.current = botTurn(s)
      setTimeout(stepBot, BOT_DELAY)
    }
  })

  useEffect(() => {
    if (s.phase === 'over' && !scored.current && s.winner) {
      scored.current = true
      setScore((sc) => ({ ...sc, [s.winner!]: sc[s.winner!] + 1 }))
    }
  })

  const rematch = () => {
    g.current = newGame(deck, opponent, s.winner === 'me' ? 'bot' : 'me') // loser starts
    botRun.current = null
    scored.current = false
    setMode({ kind: 'idle' })
    setBottomSel([])
    rerender()
  }

  const myTurn = s.active === 'me' && s.phase === 'main' && !botRun.current
  const lastLines = s.log.slice(-2)

  // ---- interactions
  const onMyPerm = (p: Perm) => {
    if (mode.kind === 'attack') {
      if (!canAttack(p)) return
      setMode({ kind: 'attack', selected: mode.selected.includes(p.uid) ? mode.selected.filter((u) => u !== p.uid) : [...mode.selected, p.uid] })
      return
    }
    if (mode.kind === 'block') {
      if (mode.attacker == null) return
      const atk = s.bot.battlefield.find((x) => x.uid === mode.attacker)!
      if (!canBlock(p, atk)) {
        setError(`${displayName(p.card)} can't block ${displayName(atk.card)}${kw(atk.card, 'Flying') ? ' (it has flying)' : ''}.`)
        return
      }
      update((g) => {
        for (const [a, b] of Object.entries(g.blocks)) if (b === p.uid) delete g.blocks[Number(a)]
        g.blocks[mode.attacker!] = p.uid
      })
      setMode({ kind: 'block', attacker: null })
      return
    }
    setMenu({ kind: 'perm', owner: 'me', uid: p.uid })
  }
  const onBotPerm = (p: Perm) => {
    if (mode.kind === 'block') {
      if (!s.attackers.includes(p.uid)) return
      if (s.blocks[p.uid] != null) {
        update((g) => void delete g.blocks[p.uid])
        return
      }
      setMode({ kind: 'block', attacker: p.uid })
      return
    }
    if (mode.kind === 'attack') return
    setMenu({ kind: 'perm', owner: 'bot', uid: p.uid })
  }

  const confirmAttack = () => {
    if (mode.kind !== 'attack') return
    update((g) => {
      declareAttack(g, mode.selected)
      if (g.phase === 'block') {
        botBlocks(g)
        resolveCombat(g)
      }
    })
    setMode({ kind: 'idle' })
  }
  const confirmBlocks = () => {
    update((g) => resolveCombat(g))
    setMode({ kind: 'idle' })
    setTimeout(stepBot, BOT_DELAY)
  }

  const handCard = menu?.kind === 'hand' ? s.me.hand.find((h) => h.uid === menu.uid) : undefined
  const permMenu = menu?.kind === 'perm' ? (menu.owner === 'me' ? s.me : s.bot).battlefield.find((p) => p.uid === menu.uid) : undefined

  return (
    <div className="fixed inset-0 lg:left-64 z-[45] flex flex-col select-none" style={{ background: 'radial-gradient(900px 500px at 50% 45%, #15171c, #07080a)' }}>
      {/* Header */}
      <div className="pt-[max(8px,env(safe-area-inset-top))] border-b hairline bg-ink-900/70 backdrop-blur-xl">
        <div className="flex items-center gap-2 px-3 md:px-5 pb-1.5">
          <Link to={`/deck/${deck.id}`} className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center" aria-label="Leave">
            <ChevronLeft size={20} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className={cx('text-sm font-semibold truncate', myTurn && 'text-gold')}>
              {s.phase === 'mulligan' ? 'Opening hand' : s.phase === 'over' ? 'Game over' : s.active === 'me' ? (mode.kind === 'block' ? 'Declare blockers' : 'Your turn') : mode.kind === 'block' ? 'Bot attacks — block!' : 'Bot is thinking…'}
            </div>
            <div className="text-[11px] text-fg-3 truncate num">
              Turn {s.turn} · You {score.me} – {score.bot} Bot · vs {opponent.name}
            </div>
          </div>
          <button className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-fg-2" onClick={() => setLogOpen(true)} aria-label="Game log">
            <ScrollText size={18} />
          </button>
        </div>
        {lastLines.length > 0 && (
          <div className="px-4 pb-1.5 text-[11px] text-fg-3 truncate">
            {lastLines.map((l, i) => (
              <span key={i}>
                <b className="text-fg-2">{l.side === 'me' ? 'You' : l.side === 'bot' ? 'Bot' : ''}</b> {l.text}{' '}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Bot side */}
      <Side
        label="Bot"
        icon={<Bot size={13} />}
        p={s.bot}
        life={s.bot.life}
        onLife={(d) => update((g) => void ((g.bot.life += d), say(g, 'me', `${d < 0 ? 'deals' : 'gives'} ${Math.abs(d)} ${d < 0 ? 'damage to' : 'life to'} the bot.`)))}
        onPerm={onBotPerm}
        highlight={(p) => (s.attackers.includes(p.uid) && s.active === 'bot' ? (mode.kind === 'block' && mode.attacker === p.uid ? 'select' : 'attack') : undefined)}
        blockLabel={(p) => {
          const b = s.blocks[p.uid]
          return b != null ? `blocked by ${displayName(s.me.battlefield.find((x) => x.uid === b)!.card).split(',')[0]}` : undefined
        }}
        hideHand
      />

      <div className="h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent mx-4" />

      {/* My side */}
      <Side
        label="You"
        p={s.me}
        life={s.me.life}
        mine
        onLife={(d) => update((g) => void ((g.me.life += d), say(g, 'me', `${d < 0 ? 'loses' : 'gains'} ${Math.abs(d)} life.`)))}
        onPerm={onMyPerm}
        highlight={(p) =>
          mode.kind === 'attack' ? (mode.selected.includes(p.uid) ? 'attack' : canAttack(p) ? 'can' : undefined) : mode.kind === 'block' && Object.values(s.blocks).includes(p.uid) ? 'select' : undefined
        }
      />

      {/* Hand + actions */}
      <div className="border-t hairline bg-ink-900/80 backdrop-blur-xl pb-[max(8px,env(safe-area-inset-bottom))]">
        {error && <div className="px-4 pt-2 text-xs text-need">{error}</div>}
        <div className="flex items-center gap-1.5 px-3 md:px-5 pt-2 overflow-x-auto no-scrollbar">
          <span className="eyebrow whitespace-nowrap mr-1">
            Hand · {s.me.hand.length} · <Zap size={10} className="inline" /> {manaAvailable(s.me)}
          </span>
          <div className="ml-auto flex gap-1.5">
            {s.phase === 'mulligan' ? null : mode.kind === 'attack' ? (
              <>
                <ActionBtn onClick={() => setMode({ kind: 'idle' })}>Cancel</ActionBtn>
                <ActionBtn accent onClick={confirmAttack} disabled={!mode.selected.length}>
                  <Swords size={13} /> Attack with {mode.selected.length}
                </ActionBtn>
              </>
            ) : mode.kind === 'block' ? (
              <ActionBtn accent onClick={confirmBlocks}>
                Confirm blocks ({Object.keys(s.blocks).length})
              </ActionBtn>
            ) : (
              <>
                <ActionBtn onClick={() => update((g) => (draw(g, 'me'), say(g, 'me', 'draws a card.')))} disabled={s.phase === 'over'}>
                  Draw
                </ActionBtn>
                <ActionBtn onClick={() => setMode({ kind: 'attack', selected: [] })} disabled={!myTurn || !s.me.battlefield.some(canAttack)}>
                  <Swords size={13} /> Attack
                </ActionBtn>
                <ActionBtn accent onClick={() => update((g) => (say(g, 'me', 'ends the turn.'), endTurn(g)))} disabled={!myTurn}>
                  End turn
                </ActionBtn>
              </>
            )}
          </div>
        </div>
        {mode.kind === 'block' && (
          <p className="px-4 pt-1 text-[11px] text-fg-2">Tap an attacking bot creature, then one of your untapped creatures to block it. Tap a blocked attacker to undo.</p>
        )}
        {mode.kind === 'attack' && <p className="px-4 pt-1 text-[11px] text-fg-2">Tap your creatures to choose attackers.</p>}
        <div className="flex justify-center-safe px-3 pt-2.5 pb-1 overflow-x-auto no-scrollbar min-h-[112px]">
          {s.me.hand.map((h, i) => {
            const n = s.me.hand.length
            const w = Math.min(84, Math.max(56, 600 / Math.max(1, n)))
            const payable = !isLand(h.card) && !!payment(s.me, h.card)
            const playableLand = isLand(h.card) && !s.me.landPlayed
            return (
              <button
                key={h.uid}
                onClick={() =>
                  s.phase === 'mulligan'
                    ? s.me.mulligans && setBottomSel((b) => (b.includes(h.uid) ? b.filter((x) => x !== h.uid) : b.length < s.me.mulligans ? [...b, h.uid] : b))
                    : setMenu({ kind: 'hand', uid: h.uid })
                }
                className={cx('shrink-0 relative transition-transform duration-300 hover:-translate-y-3', bottomSel.includes(h.uid) && '-translate-y-3')}
                style={{ width: w, marginLeft: i ? -w * 0.28 : 0 }}
              >
                <CardImage card={h.card} small className={cx('shadow-xl shadow-black/60', myTurn && (payable || playableLand) && 'ring-2 ring-own/70', bottomSel.includes(h.uid) && 'ring-2 ring-need')} />
              </button>
            )
          })}
        </div>
      </div>

      {/* Mulligan */}
      {s.phase === 'mulligan' && (
        <div className="absolute inset-x-0 bottom-40 flex justify-center px-4 z-10">
          <div className="glass rounded-2xl px-5 py-4 flex flex-col sm:flex-row items-center gap-4 max-w-xl w-full" style={{ background: 'rgb(17 19 23 / .94)' }}>
            <div className="flex-1 text-center sm:text-left text-sm">
              {s.me.mulligans ? (
                <>
                  Choose <b>{s.me.mulligans}</b> card{s.me.mulligans > 1 ? 's' : ''} to put on the bottom <span className="text-fg-3 num">({bottomSel.length}/{s.me.mulligans})</span>
                </>
              ) : (
                <>
                  <b>{s.me.hand.filter((h) => isLand(h.card)).length} lands</b> in your opening hand. {s.firstPlayer === 'me' ? 'You go first.' : 'The bot goes first.'}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => update((g) => myMulligan(g, deck))} disabled={s.me.mulligans >= 5}>
                <Shuffle size={15} /> Mulligan
              </button>
              <button
                className="btn btn-primary"
                disabled={bottomSel.length !== s.me.mulligans}
                onClick={() => {
                  update((g) => myKeep(g, bottomSel))
                  setBottomSel([])
                }}
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game over */}
      {s.phase === 'over' && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="panel p-7 max-w-sm w-full text-center" style={{ animation: 'pop .4s both' }}>
            <Trophy size={34} className={cx('mx-auto mb-3', s.winner === 'me' ? 'text-gold' : 'text-fg-3')} />
            <h2 className="display text-4xl mb-1">{s.winner === 'me' ? 'You win!' : 'The bot wins'}</h2>
            <p className="text-fg-3 text-sm mb-5 num">
              Series: you {score.me} – {score.bot} bot
            </p>
            <button className="btn btn-primary w-full" onClick={rematch}>
              Rematch
            </button>
            <button className="btn btn-ghost w-full mt-2" onClick={onChangeOpponent}>
              Change opponent
            </button>
          </div>
        </div>
      )}

      {/* Hand card menu */}
      <Sheet open={!!handCard} onClose={() => setMenu(null)} title={handCard ? displayName(handCard.card) : ''}>
        {handCard && (
          <div className="flex gap-4">
            <CardImage card={handCard.card} className="w-36 shrink-0" />
            <div className="flex-1 grid gap-2 content-start">
              {isLand(handCard.card) ? (
                <button className="btn btn-primary btn-sm" disabled={!myTurn || s.me.landPlayed} onClick={() => (update((g) => playLand(g, 'me', handCard.uid)), setMenu(null))}>
                  {s.me.landPlayed ? 'Land already played' : 'Play land'}
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-xs text-fg-3">
                    Cost <ManaCost cost={handCard.card.manaCost} size={14} />
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={!payment(s.me, handCard.card)} onClick={() => (update((g) => cast(g, 'me', handCard.uid)), setMenu(null))}>
                    {payment(s.me, handCard.card) ? 'Cast' : 'Not enough mana'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => (update((g) => cast(g, 'me', handCard.uid, true)), setMenu(null))}>
                    Cast without paying{parseCost(handCard.card).x ? ' (X spells)' : ''}
                  </button>
                </>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  update((g) => {
                    g.me.hand = g.me.hand.filter((h) => h.uid !== handCard.uid)
                    g.me.graveyard.push(handCard.card)
                    say(g, 'me', `discards ${displayName(handCard.card)}.`)
                  })
                  setMenu(null)
                }}
              >
                Discard
              </button>
              {!isLand(handCard.card) && !isCreature(handCard.card) && (
                <p className="text-[11px] text-fg-3">After casting, apply its effect with the menus on the bot's cards or the life buttons.</p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* Permanent menu */}
      <Sheet open={!!permMenu} onClose={() => setMenu(null)} title={permMenu ? displayName(permMenu.card) : ''}>
        {permMenu && menu?.kind === 'perm' && (
          <div className="flex gap-4">
            <PermCard p={permMenu} className="w-32 shrink-0" />
            <div className="flex-1 grid gap-2 content-start">
              {(
                (menu.owner === 'bot'
                  ? [
                      ['destroy', 'Destroy'],
                      ['exile', 'Exile'],
                      ['bounce', 'Return to hand'],
                      [permMenu.tapped ? 'untap' : 'tap', permMenu.tapped ? 'Untap' : 'Tap'],
                    ]
                  : [
                      [permMenu.tapped ? 'untap' : 'tap', permMenu.tapped ? 'Untap' : 'Tap'],
                      ['sacrifice', 'Sacrifice'],
                      ['bounce', 'Return to hand'],
                      ['exile', 'Exile'],
                    ]) as [Manual, string][]
              ).map(([what, label]) => (
                <button key={what} className="btn btn-ghost btn-sm justify-start" onClick={() => (update((g) => manual(g, menu.owner, permMenu.uid, what)), setMenu(null))}>
                  {label}
                </button>
              ))}
              {isCreature(permMenu.card) && (
                <div>
                  <div className="text-[11px] text-fg-3 mb-1">Deal damage</div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} className="chip h-8 px-2.5 text-xs" onClick={() => (update((g) => manual(g, menu.owner, permMenu.uid, 'damage', n)), setMenu(null))}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Game log">
        <ul className="space-y-1.5 text-sm">
          {[...s.log].reverse().map((l, i) => (
            <li key={i}>
              <b>{l.side === 'me' ? 'You' : l.side === 'bot' ? 'Bot' : '—'}</b> <span className="text-fg-2">{l.text}</span>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}

// ---- pieces ------------------------------------------------------------------------------------------------
function Side({
  label, icon, p, life, onLife, onPerm, highlight, blockLabel, mine, hideHand,
}: {
  label: string
  icon?: React.ReactNode
  p: GameState['me']
  life: number
  onLife: (d: number) => void
  onPerm: (p: Perm) => void
  highlight: (p: Perm) => 'attack' | 'select' | 'can' | undefined
  blockLabel?: (p: Perm) => string | undefined
  mine?: boolean
  hideHand?: boolean
}) {
  const creatures = p.battlefield.filter((x) => !isLand(x.card))
  const lands = p.battlefield.filter((x) => isLand(x.card))
  return (
    <div className="flex-1 min-h-0 flex flex-col px-3 md:px-5 py-2 gap-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold flex items-center gap-1">
          {icon}
          {label}
        </span>
        <span className="text-fg-3 num flex items-center gap-2">
          {hideHand && (
            <span className="inline-flex items-center gap-0.5" title="Cards in hand">
              <Hand size={10} /> {p.hand.length}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <Layers size={10} /> {p.library.length}
          </span>
          <span>GY {p.graveyard.length}</span>
        </span>
        <div className={cx('ml-auto flex items-center rounded-full border px-0.5 h-8', mine ? 'border-own/25 bg-own/5' : 'border-need/25 bg-need/5')}>
          <button className="w-7 h-7 flex items-center justify-center text-fg-3" onClick={() => onLife(-1)} aria-label={`${label} loses life`}>
            <Minus size={12} />
          </button>
          <span className="num text-sm font-semibold w-8 text-center flex items-center gap-0.5 justify-center">
            <Heart size={10} className={mine ? 'text-own' : 'text-need'} />
            {life}
          </span>
          <button className="w-7 h-7 flex items-center justify-center text-fg-3" onClick={() => onLife(1)} aria-label={`${label} gains life`}>
            <Plus size={12} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-wrap gap-2">
          {creatures.map((x) => (
            <button key={x.uid} onClick={() => onPerm(x)} className="relative">
              <PermCard p={x} className="w-[60px] md:w-20" state={highlight(x)} />
              {blockLabel?.(x) && <div className="absolute -bottom-1 inset-x-0 text-[9px] text-center bg-need text-ink-950 rounded px-0.5 truncate">{blockLabel(x)}</div>}
            </button>
          ))}
          {creatures.length === 0 && <div className="text-[11px] text-fg-3 py-3">No creatures or other permanents.</div>}
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto no-scrollbar min-h-[42px]">
        {lands.map((x) => (
          <button key={x.uid} onClick={() => onPerm(x)} className={cx('shrink-0 transition-transform', x.tapped && 'opacity-40')} title={displayName(x.card)}>
            <CardImage card={x.card} small className={cx('w-[30px]', x.tapped && 'rotate-12')} />
          </button>
        ))}
      </div>
    </div>
  )
}

function PermCard({ p, className, state }: { p: Perm; className?: string; state?: 'attack' | 'select' | 'can' }) {
  const creature = isCreature(p.card)
  const ring = state === 'attack' ? 'ring-2 ring-gold' : state === 'select' ? 'ring-2 ring-need' : state === 'can' ? 'ring-1 ring-own/60' : ''
  return (
    <div className={cx('relative transition-transform duration-300', p.tapped && 'rotate-[14deg] opacity-75', className)}>
      {p.token ? (
        <div className={cx('card-img flex flex-col items-center justify-center border border-white/15 bg-gradient-to-br from-ink-600 to-ink-800 text-center p-1', ring)}>
          <div className="text-[9px] text-fg-3">Token</div>
        </div>
      ) : (
        <CardImage card={p.card} small className={ring} />
      )}
      {creature && (
        <span className={cx('absolute bottom-0.5 right-0.5 num text-[10px] font-bold px-1 rounded bg-black/85 border border-white/15', p.damage > 0 && 'text-need')}>
          {power(p)}/{toughness(p) - p.damage}
        </span>
      )}
      {creature && p.sick && !kw(p.card, 'Haste') && <span className="absolute top-0.5 right-0.5 text-[9px] px-1 rounded bg-black/80 text-fg-3">zzz</span>}
    </div>
  )
}

function ActionBtn({ children, onClick, disabled, accent }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cx('chip h-9 px-3 text-xs shrink-0', disabled && 'opacity-40', accent && !disabled && 'text-ink-950 bg-gold border-gold font-semibold')}>
      {children}
    </button>
  )
}
