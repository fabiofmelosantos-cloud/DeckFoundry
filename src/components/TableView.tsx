import { useMemo, useState, type Dispatch, type ReactNode } from 'react'
import { Coins, Crown, Dices, Shuffle } from 'lucide-react'
import type { Deck } from '../lib/types'
import { isLand, displayName } from '../lib/cardDb'
import { zoneOf, type Inst, type TableAction, type TableState, type Zone } from '../lib/table'
import { CardImage, Sheet, cx } from './ui'

// My side of the table: battlefield, piles, hand, mulligan flow and card actions.
// Used by solo playtesting and by online rooms (which add opponents on top).

interface Props {
  state: TableState
  dispatch: Dispatch<TableAction>
  deck: Deck
  header: ReactNode
  top?: ReactNode // opponents, in online games
  tools?: ReactNode // extra buttons before the built-in ones
  onRoll?: (label: string, value: string) => void
  onAction?: (text: string) => void // human-readable log of what I did
  compact?: boolean
}

export function TableView({ state, dispatch, deck, header, top, tools, onRoll, onAction, compact }: Props) {
  const [roll, setRoll] = useState<{ label: string; value: string; k: number } | null>(null)
  const [menu, setMenu] = useState<Inst | null>(null)
  const [pile, setPile] = useState<Zone | null>(null)
  const [bottomSel, setBottomSel] = useState<number[]>([])
  const { phase, mulligans } = state
  const hand = zoneOf(state, 'hand')
  const battlefield = zoneOf(state, 'battlefield')
  const library = zoneOf(state, 'library')
  const handLands = hand.filter((c) => isLand(c.card)).length
  const lands = battlefield.filter((c) => isLand(c.card))
  const permanents = battlefield.filter((c) => !isLand(c.card))
  const handWidth = useMemo(() => Math.min(compact ? 78 : 96, Math.max(54, 680 / Math.max(1, hand.length))), [hand.length, compact])
  const log = (t: string) => onAction?.(t)
  const commanderIds = useMemo(() => new Set(deck.cards.filter((c) => c.commander).map((c) => c.card.id)), [deck])
  const tax = (state.cmdCasts ?? 0) * 2

  const dice = (label: string, fn: () => string) => {
    const value = fn()
    setRoll({ label, value, k: Date.now() })
    onRoll?.(label, value)
  }
  const move = (c: Inst, to: Zone, where?: 'top' | 'bottom') => {
    dispatch({ t: 'move', uid: c.uid, to, where })
    const name = displayName(c.card)
    const verb: Record<Zone, string> = { battlefield: `played ${name}`, graveyard: `put ${name} into the graveyard`, exile: `exiled ${name}`, hand: `returned ${name} to hand`, library: `put ${name} on the ${where ?? 'top'} of the library`, command: `returned ${name} to the command zone` }
    // Cards moving from hand to the library stay hidden
    log(to === 'library' && c.zone === 'hand' ? `put a card on the ${where ?? 'top'} of the library` : verb[to])
  }
  const onCard = (c: Inst) => {
    if (phase === 'bottom' && c.zone === 'hand') {
      setBottomSel((s) => (s.includes(c.uid) ? s.filter((x) => x !== c.uid) : s.length < mulligans ? [...s, c.uid] : s))
      return
    }
    if (phase !== 'play') return
    if (c.zone === 'battlefield') {
      dispatch({ t: 'tap', uid: c.uid })
      log(`${c.tapped ? 'untapped' : 'tapped'} ${displayName(c.card)}`)
      return
    }
    setMenu(c)
  }

  return (
    <div className="fixed inset-0 lg:left-64 z-[45] flex flex-col bg-ink-950 select-none" style={{ background: 'radial-gradient(900px 500px at 50% 40%, #15171c, #07080a)' }}>
      {header}
      {top}

      {/* My battlefield */}
      <div className={cx('flex-1 overflow-auto relative', compact ? 'p-2 md:p-4' : 'p-3 md:p-5')}>
        <div className="flex gap-3 md:gap-4 h-full">
          <div className="flex-1 flex flex-col gap-2 md:gap-3 min-w-0">
            <ZoneRow label="Battlefield" cards={permanents} onCard={onCard} compact={compact} empty={phase === 'play' ? 'Tap a card in your hand to play it' : ''} />
            <ZoneRow label="Lands" cards={lands} onCard={onCard} small compact={compact} />
          </div>
          <div className={cx('flex flex-col gap-2 md:gap-3 shrink-0', compact ? 'w-12 md:w-20' : 'w-16 md:w-24')}>
            {deck.commander && (
              <CommandSlot
                commander={deck.commander}
                inZone={zoneOf(state, 'command')[0]}
                tax={tax}
                onOpen={(c) => (c && phase === 'play' ? setMenu(c) : setPile('command'))}
              />
            )}
            <Pile
              label="Library"
              cards={library}
              faceDown
              hint="Draw"
              onOpen={() => {
                if (phase !== 'play') return
                dispatch({ t: 'draw', n: 1 })
                log('drew a card')
              }}
            />
            <Pile label="Graveyard" cards={zoneOf(state, 'graveyard')} onOpen={() => setPile('graveyard')} />
            <Pile label="Exile" cards={zoneOf(state, 'exile')} onOpen={() => setPile('exile')} />
          </div>
        </div>

        {phase !== 'play' && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-4 z-10">
            <div className="glass rounded-2xl px-5 py-4 flex flex-col sm:flex-row items-center gap-4 max-w-xl w-full" style={{ background: 'rgb(17 19 23 / .92)' }}>
              {phase === 'opening' ? (
                <>
                  <div className="flex-1 text-center sm:text-left">
                    <div className="font-semibold">{mulligans ? `Mulligan to ${7 - mulligans}` : 'Opening hand'}</div>
                    <div className="text-sm text-fg-3">
                      {handLands} land{handLands === 1 ? '' : 's'} · {7 - handLands} spells{' '}
                      {handLands >= 2 && handLands <= 4 ? <span className="text-own">— looks keepable</span> : <span className="text-need">— risky</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        dispatch({ t: 'mulligan', deck })
                        setBottomSel([])
                        log(`took a mulligan`)
                      }}
                      disabled={mulligans >= 6}
                    >
                      Mulligan
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        dispatch({ t: 'keep' })
                        log(`kept ${7 - mulligans}`)
                      }}
                    >
                      Keep
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1 text-sm">
                    Choose <b>{mulligans}</b> card{mulligans > 1 ? 's' : ''} to put on the bottom <span className="text-fg-3 num">({bottomSel.length}/{mulligans})</span>
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={bottomSel.length !== mulligans}
                    onClick={() => {
                      dispatch({ t: 'bottom', uids: bottomSel })
                      setBottomSel([])
                    }}
                  >
                    Confirm
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Hand */}
      <div className="border-t hairline bg-ink-900/70 backdrop-blur-xl pb-[max(8px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 px-3 md:px-5 pt-2">
          <span className="eyebrow whitespace-nowrap">Hand · {hand.length}</span>
          <div className="ml-auto flex gap-1.5 overflow-x-auto no-scrollbar">
            {tools}
            <Tool
              onClick={() => {
                dispatch({ t: 'draw', n: 1 })
                log('drew a card')
              }}
              disabled={phase !== 'play'}
            >
              Draw
            </Tool>
            <Tool
              onClick={() => {
                dispatch({ t: 'shuffle' })
                log('shuffled their library')
              }}
            >
              <Shuffle size={13} />
            </Tool>
            <Tool onClick={() => dice('d6', () => String(1 + Math.floor(Math.random() * 6)))}>
              <Dices size={13} /> d6
            </Tool>
            <Tool onClick={() => dice('d20', () => String(1 + Math.floor(Math.random() * 20)))}>
              <Dices size={13} /> d20
            </Tool>
            <Tool onClick={() => dice('Coin', () => (Math.random() < 0.5 ? 'Heads' : 'Tails'))}>
              <Coins size={13} />
            </Tool>
          </div>
        </div>
        <div className={cx('flex justify-center-safe px-3 pt-3 pb-2 overflow-x-auto no-scrollbar', compact ? 'min-h-[118px]' : 'min-h-[150px]')}>
          {hand.map((c, i) => (
            <button
              key={c.uid}
              onClick={() => onCard(c)}
              className={cx('shrink-0 transition-all duration-300 hover:-translate-y-4 hover:z-10 relative', bottomSel.includes(c.uid) && '-translate-y-4')}
              style={{ width: handWidth * 1.4, marginLeft: i === 0 ? 0 : -handWidth * 0.35, animation: 'rise .4s both', animationDelay: `${i * 40}ms` }}
            >
              <CardImage card={c.card} small className={cx('shadow-xl shadow-black/60', bottomSel.includes(c.uid) && 'ring-2 ring-need')} />
            </button>
          ))}
        </div>
      </div>

      {roll && (
        <div key={roll.k} className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="glass rounded-3xl px-10 py-8 text-center pointer-events-auto" style={{ animation: 'pop .4s both', background: 'rgb(17 19 23 / .92)' }} onClick={() => setRoll(null)}>
            <div className="eyebrow mb-1">{roll.label}</div>
            <div className="display text-7xl text-gold">{roll.value}</div>
          </div>
        </div>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu ? displayName(menu.card) : ''}>
        {menu && (
          <div className="flex gap-4">
            <CardImage card={menu.card} className="w-36 shrink-0" />
            <div className="flex-1 grid gap-2 content-start">
              {menu.zone === 'command' && (
                <p className="text-xs text-gold">
                  Commander tax: {tax ? `+${tax} mana` : 'none yet'}. Casting it from here adds +2 next time.
                </p>
              )}
              {(
                [
                  ['battlefield', 'Play to battlefield'],
                  ['graveyard', 'Graveyard'],
                  ['exile', 'Exile'],
                  ['hand', 'Hand'],
                  ['library', 'Top of library'],
                  ...(commanderIds.has(menu.card.id) ? [['command', 'Command zone'] as [Zone, string]] : []),
                ] as [Zone, string][]
              )
                .filter(([z]) => z !== menu.zone)
                .map(([z, label]) => (
                  <button
                    key={z}
                    className={cx('btn btn-sm justify-start', z === 'battlefield' ? 'btn-primary' : 'btn-ghost')}
                    onClick={() => {
                      move(menu, z)
                      setMenu(null)
                    }}
                  >
                    {label}
                  </button>
                ))}
              <button
                className="btn btn-sm btn-ghost justify-start"
                onClick={() => {
                  move(menu, 'library', 'bottom')
                  setMenu(null)
                }}
              >
                Bottom of library
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!pile} onClose={() => setPile(null)} title={pile ? pile[0].toUpperCase() + pile.slice(1) : ''}>
        <div className="grid grid-cols-3 gap-3">
          {pile &&
            zoneOf(state, pile).map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  setPile(null)
                  setMenu(c)
                }}
              >
                <CardImage card={c.card} small />
              </button>
            ))}
        </div>
        {pile && zoneOf(state, pile).length === 0 && <p className="text-sm text-fg-3">Empty.</p>}
      </Sheet>
    </div>
  )
}

function ZoneRow({ label, cards, onCard, small, empty, compact }: { label: string; cards: Inst[]; onCard: (c: Inst) => void; small?: boolean; empty?: string; compact?: boolean }) {
  return (
    <div className={cx('rounded-2xl border border-dashed border-white/[.07] p-2.5 md:p-3 relative', small ? (compact ? 'min-h-[84px]' : 'min-h-[110px]') : compact ? 'flex-1 min-h-[110px]' : 'flex-1 min-h-[160px]')}>
      <div className="eyebrow absolute top-2 left-3">{label}</div>
      {cards.length === 0 && empty && <div className="absolute inset-0 flex items-center justify-center text-sm text-fg-3 px-4 text-center">{empty}</div>}
      <div className="flex flex-wrap gap-2 pt-5">
        {cards.map((c) => (
          <button
            key={c.uid}
            onClick={() => onCard(c)}
            className={cx('transition-transform duration-300', small ? (compact ? 'w-11 md:w-14' : 'w-14 md:w-16') : compact ? 'w-14 md:w-20' : 'w-20 md:w-24', c.tapped && 'rotate-90 mx-3 opacity-80')}
            style={{ animation: 'pop .35s both' }}
          >
            <CardImage card={c.card} small />
          </button>
        ))}
      </div>
    </div>
  )
}

/** The command zone, always visible: the commander with a gold frame and the current tax. */
function CommandSlot({ commander, inZone, tax, onOpen }: { commander: Deck['commander'] & object; inZone?: Inst; tax: number; onOpen: (c?: Inst) => void }) {
  return (
    <button onClick={() => onOpen(inZone)} className="text-left group" title={inZone ? 'Tap to cast your commander' : 'Your commander is not in the command zone'}>
      <div className={cx('card-img relative ring-2', inZone ? 'ring-gold shadow-[0_0_16px_-4px_rgb(231,198,127)]' : 'ring-white/10 opacity-40')}>
        <CardImage card={commander} small className="absolute inset-0" />
        {tax > 0 && <span className="absolute bottom-1 inset-x-1 text-center text-[9px] font-semibold rounded bg-black/80 text-gold">+{tax}</span>}
      </div>
      <div className="flex items-center gap-1 text-[10px] md:text-[11px] text-gold mt-1 truncate">
        <Crown size={11} className="shrink-0" /> {inZone ? 'Cmdr' : 'In play'}
      </div>
    </button>
  )
}

function Pile({ label, cards, onOpen, faceDown, hint, icon }: { label: string; cards: Inst[]; onOpen: () => void; faceDown?: boolean; hint?: string; icon?: ReactNode }) {
  const top = cards[faceDown ? 0 : cards.length - 1]
  return (
    <button onClick={onOpen} className="text-left group">
      <div className="card-img relative border border-white/10">
        {faceDown ? (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'repeating-linear-gradient(45deg, #1a1c22 0 6px, #16181d 6px 12px)' }}>
            <svg width="22" height="22" viewBox="0 0 32 32" className="opacity-60">
              <path d="M16 3l11 6.3v13.4L16 29 5 22.7V9.3z" fill="none" stroke="#e7c67f" strokeWidth="1.8" />
            </svg>
          </div>
        ) : top ? (
          <CardImage card={top.card} small className="absolute inset-0" />
        ) : null}
        {hint && <span className="absolute inset-x-1 bottom-1 text-[10px] text-center rounded bg-black/70 opacity-0 group-hover:opacity-100 transition">{hint}</span>}
      </div>
      <div className="flex items-center justify-between text-[10px] md:text-[11px] text-fg-3 mt-1">
        <span className="flex items-center gap-1 truncate">
          {icon}
          {label}
        </span>
        <span className="num">{cards.length}</span>
      </div>
    </button>
  )
}

export function Tool({ children, onClick, disabled, accent }: { children: ReactNode; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cx('chip h-8 px-3 text-xs shrink-0', disabled && 'opacity-40', accent && 'text-gold border-gold/40 bg-gold/10')}>
      {children}
    </button>
  )
}
