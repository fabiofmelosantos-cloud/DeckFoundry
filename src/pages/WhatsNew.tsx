import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Swords, Users } from 'lucide-react'
import { whatsNew, type NewCardInsight } from '../lib/discovery'
import { setPrefs, useOwned, useStore } from '../lib/store'
import { displayName, price } from '../lib/cardDb'
import { tagLabel } from '../lib/tags'
import { CardImage, PageHeader, Pill, SectionHeader, StatusTag, cx, eur } from '../components/ui'

export default function WhatsNew() {
  const since = useStore((s) => s.prefs.lastPlayed)
  const owned = useOwned()
  const news = useMemo(() => whatsNew(since, owned), [since, owned])
  const [lens, setLens] = useState<'kitchen' | 'competitive'>('kitchen')
  const list = lens === 'kitchen' ? news.kitchen : news.competitive
  const fmtDate = new Date(since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="What did I miss?"
        title={
          <>
            Welcome <span className="italic text-gold">back.</span>
          </>
        }
        subtitle={
          <>
            Since you last played in <span className="text-fg">{fmtDate}</span>, {news.sets.length} sets came out. Here's what matters for <em>your</em> cards.
          </>
        }
        action={
          <label className="text-sm text-fg-3 flex items-center gap-2">
            Last played
            <input type="month" className="input h-10 w-auto" value={since.slice(0, 7)} onChange={(e) => e.target.value && setPrefs({ lastPlayed: `${e.target.value}-01` })} />
          </label>
        }
      />

      {/* Sets timeline */}
      <section>
        <SectionHeader eyebrow="Since you last played" title="New sets" />
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-2">
          {news.sets.map((s) => (
            <div key={s.code} className="panel p-4 min-w-[190px] shrink-0">
              <img src={s.icon} alt="" className="w-7 h-7 invert opacity-80 mb-3" />
              <div className="font-medium text-sm leading-tight">{s.name}</div>
              <div className="text-xs text-fg-3 mt-1">
                {new Date(s.releasedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} · {s.cardCount} cards
              </div>
            </div>
          ))}
          {news.sets.length === 0 && <p className="text-fg-3 text-sm">Nothing new since then — you're up to date.</p>}
        </div>
      </section>

      {/* New cards */}
      <section>
        <SectionHeader
          eyebrow="New cards for you"
          title={lens === 'kitchen' ? 'Kitchen Table potential' : 'Competitive relevance'}
          action={
            <div className="flex rounded-full border border-white/10 p-1 text-sm">
              <button className={cx('px-3 h-8 rounded-full flex items-center gap-1.5', lens === 'kitchen' && 'bg-white/10')} onClick={() => setLens('kitchen')}>
                <Users size={14} /> Kitchen
              </button>
              <button className={cx('px-3 h-8 rounded-full flex items-center gap-1.5', lens === 'competitive' && 'bg-white/10')} onClick={() => setLens('competitive')}>
                <Swords size={14} /> Competitive
              </button>
            </div>
          }
        />
        <div className="grid md:grid-cols-2 gap-4">
          {list.map((ins) => (
            <NewCard key={ins.card.id} ins={ins} lens={lens} owned={(owned.get(ins.card.name) ?? 0) > 0} />
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="panel p-5 md:p-6">
          <SectionHeader eyebrow="New mechanics" title="Keywords you haven't played with" />
          <ul className="divide-y divide-white/5">
            {news.mechanics.map((m) => (
              <li key={m.name} className="py-3 flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-fg-3">{m.set}</div>
                </div>
                <div className="flex -space-x-4">
                  {m.cards.slice(0, 3).map((c) => (
                    <Link key={c.id} to={`/card/${c.id}`}>
                      <CardImage card={c} small className="w-9 ring-2 ring-ink-850" />
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <div className="panel p-5 md:p-6">
            <SectionHeader eyebrow="Your cards, newly relevant" title="Old cards, new partners" />
            <ul className="space-y-3">
              {news.risers.slice(0, 5).map((r) => (
                <li key={r.card.id}>
                  <Link to={`/card/${r.card.id}`} className="flex items-center gap-3 group">
                    <CardImage card={r.card} small className="w-10" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate group-hover:text-gold">{displayName(r.card)}</div>
                      <div className="text-xs text-fg-3 truncate">Works with {r.partners.slice(0, 2).map((p) => displayName(p)).join(', ')}</div>
                    </div>
                    <StatusTag kind="own">+{r.partners.length}</StatusTag>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel p-5 md:p-6">
            <SectionHeader eyebrow="New archetypes & synergies" title="Themes the new sets push" />
            <div className="flex flex-wrap gap-2">
              {news.themes.map(([t, n]) => (
                <Pill key={t} className="h-8 px-3 text-sm">
                  {tagLabel(t)} <span className="text-fg-3 num ml-1.5">{n}</span>
                </Pill>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function NewCard({ ins, lens, owned }: { ins: NewCardInsight; lens: 'kitchen' | 'competitive'; owned: boolean }) {
  const c = ins.card
  const score = lens === 'kitchen' ? ins.kitchen : ins.competitive
  return (
    <div className="panel p-4 flex gap-4">
      <Link to={`/card/${c.id}`} className="w-28 shrink-0 lift">
        <CardImage card={c} small />
      </Link>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 mb-1">
          <StatusTag kind="disc">New card</StatusTag>
          {owned && <StatusTag kind="own" />}
        </div>
        <div className="font-semibold leading-tight">{displayName(c)}</div>
        <div className="text-xs text-fg-3 mb-2">
          {c.setName} · <span className="num">{eur(price(c))}</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="h-1.5 flex-1 rounded-full bg-white/[.06] overflow-hidden">
            <div className="h-full bg-disc rounded-full" style={{ width: `${score}%` }} />
          </div>
          <span className="text-[11px] text-fg-3 num">{score}</span>
        </div>
        <p className="text-sm text-fg-2 mb-3">
          {ins.synergies.length ? (
            <>
              This new card has synergy with <span className="text-disc font-semibold num">{ins.synergies.length} cards</span> you already own.
            </>
          ) : (
            'A strong new card, though nothing in your collection pairs with it yet.'
          )}
        </p>
        {ins.synergies.length > 0 && (
          <Link to={`/card/${c.id}`} className="mt-auto text-sm text-gold inline-flex items-center gap-1 hover:gap-2 transition-all">
            Explore synergy <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  )
}
