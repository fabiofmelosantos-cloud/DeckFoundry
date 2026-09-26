import { Link } from 'react-router-dom'
import { Info, ScanLine, Upload } from 'lucide-react'
import { useStore } from '../lib/store'

/** Makes it unmistakable when the collection isn't the user's own (demo) or is empty. */
export function DemoBanner() {
  const isDemo = useStore((s) => s.isDemo)
  const empty = useStore((s) => s.collection.length === 0)
  if (!isDemo && !empty) return null
  return (
    <div className="rounded-2xl border border-disc/25 bg-disc/[.06] p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 text-sm">
        <Info size={17} className="text-disc shrink-0 mt-0.5" />
        <div>
          {isDemo ? (
            <>
              <b>This is a demo collection</b> — these cards aren't yours. Import your collection to see what <em>you</em> can build.
            </>
          ) : (
            <>
              <b>Your collection is empty.</b> Import it or scan a few cards and DeckFoundry starts finding decks right away.
            </>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Link to="/import" className="btn btn-primary btn-sm">
          <Upload size={14} /> Import
        </Link>
        <Link to="/scan" className="btn btn-ghost btn-sm">
          <ScanLine size={14} /> Scan
        </Link>
      </div>
    </div>
  )
}
