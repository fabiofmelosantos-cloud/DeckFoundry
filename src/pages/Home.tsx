import { Link, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { ArrowRight, Dices, Hammer, History, Library, ScanLine, Sparkles, Wand2, Coins, Layers } from 'lucide-react'
import { useStore, useOwned } from '../lib/store'
import { useDiscovery, buyList, whatsNew } from '../lib/discovery'
import { collectionStats, deckHighlights, hello } from '../lib/insights'
import { cardsAway } from '../lib/analysis'
import { displayName, findCard, getCard } from '../lib/cardDb'
import { useMarket } from '../lib/market'
import { ScoreDial } from '../components/MarketUI'
import { DemoBanner } from '../components/DemoBanner'
import { ArtCrop, CardImage, DeckTile, ManaPips, PowerBadge, Ring, SectionHeader, StatusTag, cx, eur, int } from '../components/ui'

export default function Home() {
  const prefs = useStore((s) => s.prefs)
  const collection = useStore((s) => s.collection)
  const owned = useOwned()
  const disc = useDiscovery()
  const nav = useNavigate()
  const stats = useMemo(() => collectionStats(collection), [collection])
  const news = useMemo(() => whatsNew(prefs.lastPlayed, owned), [prefs.lastPlayed, owned])
  const buys = useMemo(() => buyList(disc.all).slice(0, 3), [disc.all])
  const discoveries = news.insights.filter((i) => i.synergies.length >= 5).length + disc.lab.length + disc.all.reduce((a, x) => a + x.combos.length, 0)

  const hero = disc.hero
  const highlights = hero ? deckHighlights(hero, 3) : []
  const heroCards = hero ? hero.deck.keyCards.map((n) => findCard(n)!).filter(Boolean).slice(0, 3) : []
  const recent = useMemo(
    () => [...collection].sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt)).slice(0, 12).map((e) => getCard(e.cardId)!).filter((c) => c && !/Basic/.test(c.typeLine)),
    [collection],
  )

  return (
    <div className="space-y-10 md:space-y-14">
      {/* Greeting */}
      <section className="rise">
        <p className="text-fg-3 text-sm mb-1">{hello()},</p>
        <h1 className="display text-[42px] md:text-6xl">
          {prefs.username}. <span className="text-fg-3 italic">Your collection has</span> <span className="text-gold num">{int(stats.total)}</span>{' '}
          <span className="text-fg-3 italic">cards.</span>
        </h1>
      </section>

      <DemoBanner />

      {/* Stat tiles */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 rise" style={{ animationDelay: '80ms' }}>
        <Stat icon={<Library size={16} />} label="Collection" value={int(stats.total)} sub={`${int(stats.unique)} unique`} to="/collection" />
        <Stat icon={<Coins size={16} />} label="Value" value={eur(stats.value, 0)} sub="Cardmarket trend" to="/collection?sort=value" />
        <Stat icon={<Layers size={16} />} label="Decks ready" value={String(disc.ready.length)} sub={`${disc.all.filter((a) => a.pct >= 85 && a.pct < 100).length} almost there`} to="/discover" accent="own" />
        <Stat icon={<Sparkles size={16} />} label="New discoveries" value={String(discoveries)} sub="combos, synergies & ideas" to="/whats-new" accent="disc" />
      </section>

      {/* Hero */}
      {hero && (
        <section className="relative panel overflow-hidden rise" style={{ animationDelay: '160ms' }}>
          <ArtCrop card={heroCards[0]} className="absolute inset-0 opacity-30 blur-[2px] scale-110" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-850 via-ink-850/95 to-ink-850/60" />
          <div className="relative grid md:grid-cols-[1.2fr_1fr] gap-8 p-6 md:p-10">
            <div>
              <StatusTag kind="disc">We found something in your collection</StatusTag>
              <div className="flex items-center gap-3 mt-5 mb-2">
                <ManaPips colors={hero.deck.colors} size={20} />
                <PowerBadge power={hero.deck.power} />
              </div>
              <h2 className="display text-5xl md:text-6xl mb-3">{hero.deck.name}</h2>
              <p className="text-fg-2 max-w-md mb-6">{hero.deck.tagline}</p>
              <div className="flex items-center gap-5 mb-7">
                <Ring pct={hero.pct} size={76} stroke={6}>
                  <div className="text-center leading-none">
                    <div className="num text-lg font-semibold">{hero.pct}%</div>
                    <div className="text-[10px] text-fg-3 mt-0.5">complete</div>
                  </div>
                </Ring>
                <div>
                  <div className="text-lg">
                    You already own <span className="num font-semibold text-own">{hero.owned}</span>
                    <span className="text-fg-3">/{hero.total}</span> cards
                  </div>
                  <div className="text-sm text-fg-3">
                    {cardsAway(hero)} cards away · <span className="text-need">{eur(hero.costToComplete)}</span> to complete
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button className="btn btn-primary" onClick={() => nav(`/deck/${hero.deck.id}`)}>
                  <Hammer size={16} /> Build deck
                </button>
                <button className="btn btn-ghost" onClick={() => nav(`/deck/${hero.deck.id}?missing=1`)}>
                  Show missing cards
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-6">
              <div className="hidden md:flex justify-center items-end h-56 relative">
                {heroCards.map((c, i) => (
                  <Link
                    key={c.id}
                    to={`/card/${c.id}`}
                    className="absolute bottom-0 transition-transform duration-500 hover:-translate-y-3"
                    style={{ transform: `translateX(${(i - 1) * 88}px) rotate(${(i - 1) * 8}deg) translateY(${Math.abs(i - 1) * 10}px)`, zIndex: i === 1 ? 2 : 1 }}
                  >
                    <CardImage card={c} className="w-36 shadow-2xl shadow-black/60" />
                  </Link>
                ))}
              </div>
              <div>
                <div className="eyebrow mb-3">Why this deck?</div>
                <ul className="space-y-2.5">
                  {highlights.map((h, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className={cx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', h.combo ? 'bg-disc' : 'bg-gold')} />
                      <span>
                        <span className="font-medium">{h.a.name.split(' // ')[0]}</span> <span className="text-fg-3">+</span>{' '}
                        <span className="font-medium">{h.b.name.split(' // ')[0]}</span>
                        <span className="text-fg-3"> — {h.text}</span>
                        {h.combo && <StatusTag kind="disc" className="ml-2 align-middle">Combo</StatusTag>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Quick actions */}
      <section className="grid md:grid-cols-3 gap-3 md:gap-4">
        <Action to="/scan" icon={<ScanLine size={20} />} title="Scan cards" text="Point your camera at 10–20 cards at once." />
        <Action to="/discover#build" icon={<Wand2 size={20} />} title="Build from my collection" text="Ask for a deck — Commander, budget, weird." />
        <Action to="/lab?surprise=1" icon={<Dices size={20} />} title="Surprise me" text="Build something I would never have thought of." accent />
      </section>

      {/* What you can build */}
      <section>
        <SectionHeader
          eyebrow="Here's what you can build"
          title="Ready or nearly ready"
          action={
            <Link to="/discover" className="text-sm text-fg-2 hover:text-fg inline-flex items-center gap-1">
              All decks <ArrowRight size={14} />
            </Link>
          }
        />
        <div className="flex md:grid md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 snap-x">
          {disc.all.slice(0, 8).map((a) => (
            <div key={a.deck.id} className="min-w-[78%] sm:min-w-[45%] md:min-w-0 snap-start">
              <DeckTile a={a} />
            </div>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        {/* Smart buy */}
        <div className="panel p-5 md:p-6">
          <SectionHeader
            eyebrow="What should I buy?"
            title="Smallest spend, biggest unlock"
            action={
              <Link to="/buy" className="text-sm text-fg-2 hover:text-fg inline-flex items-center gap-1">
                Buy list <ArrowRight size={14} />
              </Link>
            }
          />
          <ul className="divide-y divide-white/5">
            {buys.map((b) => (
              <li key={b.card.id} className="flex items-center gap-4 py-3">
                <CardImage card={b.card} small className="w-11 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{b.card.name.split(' // ')[0]}</div>
                  <div className="text-xs text-fg-3">
                    {b.unlocks.length > 0 && <span className="text-own">Completes {b.unlocks.length} deck{b.unlocks.length > 1 ? 's' : ''} · </span>}
                    Improves {b.unlocks.length + b.improves.length} strateg{b.unlocks.length + b.improves.length > 1 ? 'ies' : 'y'}
                  </div>
                </div>
                <StatusTag kind="need">{eur(b.price)}</StatusTag>
              </li>
            ))}
          </ul>
        </div>

        {/* Since you last played */}
        <Link to="/whats-new" className="panel p-5 md:p-6 lift hover:border-white/15 block">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="eyebrow mb-1.5">Welcome back</div>
              <h2 className="text-lg md:text-xl font-semibold tracking-tight">
                {news.sets.length} new sets since you last played
              </h2>
            </div>
            <History size={18} className="text-fg-3" />
          </div>
          <div className="flex flex-wrap gap-2 mb-5">
            {news.sets.slice(0, 6).map((s) => (
              <span key={s.code} className="chip">
                <img src={s.icon} alt="" className="w-3.5 h-3.5 invert opacity-70" />
                {s.name}
              </span>
            ))}
          </div>
          {news.kitchen[0] && (
            <div className="flex items-center gap-4 rounded-2xl bg-disc/[.06] border border-disc/20 p-3">
              <CardImage card={news.kitchen[0].card} small className="w-12 shrink-0" />
              <div className="text-sm">
                <span className="font-medium">{news.kitchen[0].card.name.split(' // ')[0]}</span>
                <span className="text-fg-2"> has synergy with </span>
                <span className="text-disc font-semibold num">{news.kitchen[0].synergies.length} cards</span>
                <span className="text-fg-2"> you already own.</span>
              </div>
            </div>
          )}
        </Link>
      </section>

      <UpsideTeaser />

      {/* Recently added */}
      {recent.length > 0 && (
        <section>
          <SectionHeader eyebrow="Recently added" title="Latest in your collection" />
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-2">
            {recent.map((c) => (
              <Link key={c.id} to={`/card/${c.id}`} className="w-28 md:w-32 shrink-0 lift">
                <CardImage card={c} small />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ icon, label, value, sub, to, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; to: string; accent?: 'own' | 'disc' }) {
  return (
    <Link to={to} className="panel p-4 md:p-5 lift hover:border-white/15 group">
      <div className="flex items-center justify-between text-fg-3 mb-3">
        <span className="eyebrow">{label}</span>
        <span className={cx('transition-colors', accent === 'own' ? 'text-own' : accent === 'disc' ? 'text-disc' : 'group-hover:text-gold')}>{icon}</span>
      </div>
      <div className={cx('num text-[28px] md:text-[34px] font-semibold tracking-tight leading-none', accent === 'own' && 'text-own', accent === 'disc' && 'text-disc')}>{value}</div>
      <div className="text-xs text-fg-3 mt-2">{sub}</div>
    </Link>
  )
}

function Action({ to, icon, title, text, accent }: { to: string; icon: React.ReactNode; title: string; text: string; accent?: boolean }) {
  return (
    <Link to={to} className={cx('panel p-5 lift flex items-center gap-4 hover:border-white/15 group', accent && 'bg-gradient-to-br from-disc/[.08] to-transparent border-disc/20')}>
      <div className={cx('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', accent ? 'bg-disc/15 text-disc' : 'bg-gold/10 text-gold')}>{icon}</div>
      <div className="flex-1">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-fg-3">{text}</div>
      </div>
      <ArrowRight size={16} className="text-fg-3 group-hover:text-fg group-hover:translate-x-0.5 transition-all" />
    </Link>
  )
}


function UpsideTeaser() {
  const market = useMarket()
  const picks = market?.potentials.filter((p) => !p.categories.includes('avoid') && p.price >= 1).slice(0, 3) ?? []
  const avoid = market?.potentials.filter((p) => p.categories.includes('avoid')).length ?? 0
  return (
    <section className="panel p-5 md:p-6">
      <SectionHeader
        eyebrow="Buy potential"
        title="Cards with upside right now"
        action={
          <Link to="/market" className="text-sm text-fg-2 hover:text-fg inline-flex items-center gap-1">
            Market <ArrowRight size={14} />
          </Link>
        }
      />
      {!market ? (
        <div className="grid md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl shimmer" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-3">
            {picks.map((p) => (
              <Link key={p.card.id} to={`/card/${p.card.id}`} className="flex items-center gap-3 rounded-2xl bg-white/[.03] border border-white/5 p-3 hover:border-white/15 transition-colors">
                <CardImage card={p.card} small className="w-11 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{displayName(p.card)}</div>
                  <div className="text-xs text-fg-3 line-clamp-2">{p.thesis.split(' · ')[0]}</div>
                </div>
                <ScoreDial score={p.score} size={40} />
              </Link>
            ))}
          </div>
          {avoid > 0 && (
            <p className="text-xs text-fg-3 mt-4">
              <span className="text-need">{avoid} reprints announced</span> in upcoming sets — check before you buy.
            </p>
          )}
        </>
      )}
    </section>
  )
}
