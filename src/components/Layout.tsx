import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { useEffect } from 'react'
import { Home, Library, Compass, Layers, User, ScanLine, FlaskConical, ShoppingBag, History, TrendingUp, Swords } from 'lucide-react'
import { cx, Toaster } from './ui'
import { useStore } from '../lib/store'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/collection', label: 'Collection', icon: Library },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/decks', label: 'Decks', icon: Layers },
  { to: '/profile', label: 'Profile', icon: User },
]
const EXTRA = [
  { to: '/play', label: 'Play with friends', icon: Swords },
  { to: '/lab', label: 'The Lab', icon: FlaskConical },
  { to: '/buy', label: 'What to buy', icon: ShoppingBag },
  { to: '/market', label: 'Buy potential', icon: TrendingUp },
  { to: '/whats-new', label: 'What did I miss?', icon: History },
]

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx('flex items-center gap-2.5', className)}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f5dca2" />
            <stop offset="1" stopColor="#c99f55" />
          </linearGradient>
        </defs>
        <path d="M16 3l11 6.3v13.4L16 29 5 22.7V9.3z" fill="none" stroke="url(#lg)" strokeWidth="1.8" />
        <path d="M16 9.5l5.6 3.2v6.6L16 22.5l-5.6-3.2v-6.6z" fill="url(#lg)" />
      </svg>
      <span className="font-semibold tracking-tight text-[17px]">
        Deck<span className="text-gold">Foundry</span>
      </span>
    </Link>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  const username = useStore((s) => s.prefs.username)
  const immersive = pathname.startsWith('/scan') || pathname.endsWith('/test') || pathname.endsWith('/bot')
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r hairline bg-ink-900/70 backdrop-blur-xl px-4 py-6 z-40">
        <Logo className="px-2 mb-8" />
        <Link to="/scan" className="btn btn-primary w-full mb-6">
          <ScanLine size={17} /> Scan cards
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <SideLink key={n.to} {...n} />
          ))}
        </nav>
        <div className="eyebrow px-3 mt-8 mb-2">Insights</div>
        <nav className="flex flex-col gap-0.5">
          {EXTRA.map((n) => (
            <SideLink key={n.to} {...n} />
          ))}
        </nav>
        <Link to="/profile" className="mt-auto flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-white/5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gold/80 to-disc/60 flex items-center justify-center text-ink-950 font-semibold">{username[0]}</div>
          <div className="text-sm">
            <div className="font-medium">{username}</div>
            <div className="text-fg-3 text-xs">Collector profile</div>
          </div>
        </Link>
      </aside>

      {/* Mobile top bar */}
      {!immersive && (
        <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-ink-950/75 backdrop-blur-xl border-b hairline">
          <Logo />
          <Link to="/whats-new" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/5" aria-label="What did I miss?">
            <History size={19} className="text-fg-2" />
          </Link>
        </div>
      )}

      <main className={cx(!immersive && 'px-4 md:px-8 xl:px-12 pt-6 md:pt-10 pb-32 lg:pb-16 max-w-[1400px] mx-auto')}>
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      {!immersive && (
        <>
          <Link
            to="/scan"
            className="lg:hidden fixed z-40 right-4 bottom-[88px] w-14 h-14 rounded-full btn-primary flex items-center justify-center"
            style={{ animation: 'pulse-ring 2.4s infinite' }}
            aria-label="Scan cards"
          >
            <ScanLine size={22} />
          </Link>
          <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-ink-900/85 backdrop-blur-xl border-t hairline pb-[env(safe-area-inset-bottom)]">
            <div className="grid grid-cols-5 h-[68px]">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('flex flex-col items-center justify-center gap-1 text-[11px] transition-colors', isActive ? 'text-gold' : 'text-fg-3')}>
                  {({ isActive }) => (
                    <>
                      <Icon size={21} strokeWidth={isActive ? 2.2 : 1.7} />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>
        </>
      )}
      <Toaster />
    </div>
  )
}

function SideLink({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof Home; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cx('flex items-center gap-3 h-10 px-3 rounded-xl text-[14px] transition-colors', isActive ? 'bg-white/[.07] text-fg' : 'text-fg-2 hover:text-fg hover:bg-white/[.04]')}
    >
      {({ isActive }) => (
        <>
          <Icon size={18} strokeWidth={isActive ? 2.1 : 1.7} className={isActive ? 'text-gold' : ''} />
          {label}
        </>
      )}
    </NavLink>
  )
}
