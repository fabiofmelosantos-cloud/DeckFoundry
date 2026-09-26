import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Crown, Swords, TrendingUp, Users, Unlock } from 'lucide-react'
import { buyList, useDiscovery } from '../lib/discovery'
import { useStore } from '../lib/store'
import { displayName } from '../lib/cardDb'
import { CardImage, ManaPips, PageHeader, StatusTag, cx, eur } from '../components/ui'

export default function BuyList() {
  const disc = useDiscovery()
  const budget = useStore((s) => s.prefs.budget)
  const [cap, setCap] = useState(budget)
  const all = useMemo(() => buyList(disc.all), [disc.all])
  const top = all[0]

  // Greedy cart: best score first, until the budget is spent
  const cart = useMemo(() => {
    let left = cap
    return all.filter((b) => {
      if (b.price > left) return false
      left -= b.price
      return true
    }).slice(0, 12)
  }, [all, cap])
  const cartTotal = cart.reduce((a, b) => a + b.price, 0)
  const cartUnlocks = new Set(cart.flatMap((b) => b.unlocks.map((u) => u.deck.id)))

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Smart buy list"
        title={<>What should I <span className="italic text-gold">buy?</span></>}
        subtitle="Every card below is ranked by how many possibilities it unlocks across your collection — not by hype."
        action={
          <Link to="/market" className="btn btn-ghost">
            <TrendingUp size={16} /> Cards with price upside
          </Link>
        }
      />

      {top && (
        <section className="panel p-6 md:p-8 grid md:grid-cols-[200px_1fr] gap-8 items-center relative overflow-hidden">
          <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-gold/10 blur-3xl" />
          <Link to={`/card/${top.card.id}`} className="relative max-w-[200px] mx-auto w-full">
            <CardImage card={top.card} className="shadow-2xl shadow-black/60" />
          </Link>
          <div className="relative">
            <div className="eyebrow text-gold mb-2">Buy this card</div>
            <h2 className="display text-5xl mb-1">{displayName(top.card)}</h2>
            <div className="num text-2xl text-need mb-6">{eur(top.price)}</div>
            <div className="text-sm text-fg-2 mb-3">This card improves:</div>
            <div className="grid grid-cols-3 gap-3 max-w-md mb-6">
              <Count icon={<Swords size={15} />} n={top.competitive} label="competitive decks" />
              <Count icon={<Users size={15} />} n={top.casual} label="casual decks" />
              <Count icon={<Crown size={15} />} n={top.commander} label="Commander strategies" />
            </div>
            <div className="flex flex-wrap gap-2">
              {[...top.unlocks, ...top.improves].slice(0, 6).map((a) => (
                <Link key={a.deck.id} to={`/deck/${a.deck.id}`} className="chip">
                  <ManaPips colors={a.deck.colors} size={12} />
                  {a.deck.name}
                  {top.unlocks.includes(a) && <span className="text-own text-xs">→ 100%</span>}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div>
          <h2 className="text-lg font-semibold mb-4">Ranked by impact</h2>
          <ul className="space-y-2">
            {all.slice(0, 30).map((b, i) => (
              <li key={b.card.id} className="panel p-3 md:p-4 flex items-center gap-3 md:gap-4">
                <span className="display text-2xl text-fg-3 w-7 text-center num">{i + 1}</span>
                <Link to={`/card/${b.card.id}`}>
                  <CardImage card={b.card} small className="w-11" />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{displayName(b.card)}</div>
                  <div className="text-xs text-fg-3 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {b.unlocks.length > 0 && (
                      <span className="text-own flex items-center gap-1">
                        <Unlock size={11} /> Completes {b.unlocks.map((u) => u.deck.name).join(', ')}
                      </span>
                    )}
                    {b.competitive > 0 && <span>{b.competitive} competitive</span>}
                    {b.casual > 0 && <span>{b.casual} casual</span>}
                    {b.commander > 0 && <span>{b.commander} Commander</span>}
                  </div>
                </div>
                <StatusTag kind="need">{eur(b.price)}</StatusTag>
              </li>
            ))}
          </ul>
        </div>

        <aside className="panel p-5 lg:sticky lg:top-6">
          <div className="eyebrow mb-1">Budget planner</div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm text-fg-2">Spend up to</span>
            <span className="num text-2xl font-semibold text-gold">{eur(cap, 0)}</span>
          </div>
          <input type="range" min={5} max={200} step={5} value={cap} onChange={(e) => setCap(+e.target.value)} className="w-full accent-[#e7c67f]" aria-label="Budget" />
          <div className="rounded-2xl bg-white/[.03] border border-white/5 p-4 my-4">
            <div className="text-sm">
              <span className="num font-semibold">{cart.length}</span> cards · <span className="num">{eur(cartTotal)}</span>
            </div>
            <div className={cx('text-sm', cartUnlocks.size ? 'text-own' : 'text-fg-3')}>
              {cartUnlocks.size ? `Completes ${cartUnlocks.size} deck${cartUnlocks.size > 1 ? 's' : ''} outright` : 'Moves several decks closer'}
            </div>
          </div>
          <ul className="space-y-2">
            {cart.map((b) => (
              <li key={b.card.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate">{displayName(b.card)}</span>
                <span className="num text-fg-3">{eur(b.price)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </div>
  )
}

function Count({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white/[.03] border border-white/5 p-3">
      <div className="flex items-center gap-1.5 text-fg-3 mb-1">{icon}</div>
      <div className="num text-2xl font-semibold">{n}</div>
      <div className="text-[11px] text-fg-3 leading-tight">{label}</div>
    </div>
  )
}
