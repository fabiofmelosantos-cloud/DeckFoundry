# DeckFoundry

> **Discover what your collection can do.**

Live: https://deckfoundry-eight.vercel.app · redeploy with `npx vercel --prod`

A mobile-first web app for Magic: The Gathering players with big collections. Scan or add your cards, and DeckFoundry shows you which decks you can build right now, which ones are a few cards away, what to buy next, and ideas nobody else is playing.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + production build
npm run fetch-cards  # refresh the card database snapshot from Scryfall
npm run fetch-market # refresh market signals + append today's prices to the history (run weekly)
```

Demo data is generated on first load and stored in `localStorage`. **Profile → Reset demo data** regenerates it.

## What's inside

| Area | Route | Notes |
|---|---|---|
| Dashboard | `/` | Collection / value / decks ready / discoveries, hero discovery with "Why this deck?" |
| Import | `/import` | MTG Arena deck exports, ManaBox, Moxfield, Deckbox, Archidekt, TCGplayer, Dragon Shield, any CSV or text list. Replace the demo collection or add to it; optionally save the list as a deck |
| Collection | `/collection` | Search, colour chips, filters (type, rarity, mana value, price, quantity, format, Commander legality, foil, set, acquisition date), grid/list, manual add |
| Scanner | `/scan` | Real on-device scanner: hold a card in the frame; the collector line (set code + number + language) gives the exact printing and the title confirms it. Older cards are matched by name, then you pick the edition. Also reads photos |
| Discover | `/discover` | For you / Meta / Kitchen Table / Lab / Commander, Surprise Me, "Build from my collection" prompt |
| Deck view | `/deck/:id` | Readiness, **strategy guide** (game plan by phase, mulligan with exact odds, play tips, matchups, card roles — for every deck, AI-built and imported too), why this deck, curve, types, combos, "You're N cards away", best upgrades, decklist with own/need status, export, improve, save |
| Play with friends | `/play`, `/play/:code` | Online rooms for 2 or 4 players: code, link or QR; seats and ready check; random first player; turn passing; life, poison and commander damage; shared game log and dice; several games per room with a running score |
| Play vs bot | `/deck/:id/bot` | Practice against a computer opponent: mana and colours, summoning sickness, combat with common keywords calculated automatically; the bot reads simple effects (removal, burn, bounce, draw, lifegain, tokens, wipes, mill). Your own card text you apply from the card menus |
| Test deck | `/deck/:id/test` | Opening hand, London mulligan, draw, battlefield/graveyard/exile, tap, life, d6/d20/coin |
| Card + Synergy explorer | `/card/:id` | Radial "What works with this?" graph (combo, synergy, tribal, mechanic, strategy, archetype) |
| The Lab | `/lab` | Numbered experiments, Generate another |
| Buy potential | `/market` | Cards likely to rise in price, with the reasons: new commanders, low supply, undervalued, EU/US gap, cards you own worth holding, announced reprints to avoid. Per-card "Price outlook" on every card page |
| Smart buy list | `/buy` | Cards ranked by how many decks they complete or improve, with a budget planner |
| What did I miss? | `/whats-new` | New sets since you last played, new cards (competitive vs kitchen table), new mechanics, your cards that gained relevance |
| Profile | `/profile` | Formats, competition, budget, colours, play styles, known vs original |

## Architecture

```
src/data/cards.json      Card database snapshot (external data, read-only)
src/data/sets.json       Set list for "What did I miss?"
src/data/seed/           Curated archetypes, card pool, known combos (names only)
src/lib/cardDb.ts        Card DB accessors — swap for a live API here
src/lib/store.ts         Personal data: collection, preferences, saved/generated decks
src/lib/tags.ts          Synergy tags from oracle text + enabler→payoff pairings
src/lib/analysis.ts      Deck vs collection: owned, missing, impact, cost, legality, combos
src/lib/builder.ts       Collection-aware deck builder + prompt parser
src/lib/discovery.ts     Ranking, Commander strategies, smart buy list, what's new
src/lib/market.ts        Buy-potential scoring (lazy-loaded with src/data/market.json + price-history.json)
```

- **Card database vs personal data are separate.** Cards are identified by Scryfall IDs, and the collection only stores `{cardId, qty, foil, acquiredAt}`.
- **No invented cards.** `fetch-cards` resolves every seed name against Scryfall and fails if a name doesn't exist. The builder only picks cards from `cards.json`.
- **Own / Need / Discovery** are three distinct visual states (green check, amber bag, violet sparkle). Basic lands are the only cards assumed to be available.

## Playing online (Supabase)

Rooms use **Supabase Realtime**: Presence for who's in the room, Broadcast for game messages. No database tables are needed.

1. In your Supabase project open **Project Settings → API** and copy the **Project URL** and the **anon / publishable** key. That key is meant for browsers; never use the `service_role` key here.
2. Create `.env.local` in the project root (it's git-ignored):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. In **Realtime → Settings**, public channels must be allowed. If "private channels only" is enabled, rooms can't connect.
4. Restart `npm run dev`.

**Getting the app onto the phones:**
- **Same Wi-Fi:** run `npm run dev -- --host` and open the "Network" address it prints on each phone.
- **Anywhere:** deploy the build (`npm run build`, then host `dist/` on Vercel, Netlify or Cloudflare Pages) with the same two env variables. HTTPS also enables the camera for the scanner.

Without keys, rooms fall back to a local mode that only connects tabs of the same browser — handy for testing.

**How a game stays in sync:**
- Each player is the only writer of their own table and broadcasts a public snapshot. Hand and library are sent as counts only.
- Turn order, eliminations, wins and new games follow rules that every client applies to the same messages.
- The earliest player in the room answers newcomers with the current game, so refreshing mid-game restores your table (saved per tab).
- There's no rules engine: like on a real table, players apply the rules.

## How "Buy potential" works

`scripts/fetch-market.mjs` collects, for the ~1,400 most-played Commander cards plus the Reserved List:
- **Cardmarket price guide** (public daily file): trend, lowest listing and 1/7/30-day averages per printing. This gives a 30-day trend immediately.
- **Demand:** EDHREC rank.
- **Supply:** paper printings (1 / 2 / 3–4 / 5+), last printing date, Reserved List.
- **Price:** EUR (Cardmarket) and USD (TCGplayer).
- **Announced reprints:** a printing in a set that hasn't released yet.
- **New and upcoming commanders:** recent sets and the next ~60 days.

`src/lib/market.ts` then *reads strategies* and scores each card 0–100:

| Part | Weight | Signal |
|---|---|---|
| Demand | 30 | How much it's played, and whether it's core to an established archetype |
| Supply | 25 | Few printings, years since the last one, Reserved List |
| Catalyst | 25 | New or upcoming commanders that specifically want it (each commander keeps its 6 most specific high-synergy cards, EDHREC-style), plus themes the newest sets push. Weighted by timing: hype peaks before and around release |
| Value | 20 | Cheap for its demand; US price above the usual EU/US gap; recent reprint dip |
| Penalties | – | Announced reprint (a Secret Lair counts as small), frequently reprinted at high prices, bulk price |

Momentum comes from Cardmarket's 30-day average vs its current trend. Once our own weekly snapshots cover more than 30 days, `price-history.json` takes over. These are estimates, not financial advice.

## Honest limitations of this MVP

- **Scanner scope:** it reads one card at a time. It's exact for cards printed since 2014, which have a set code and number in the bottom-left corner; older cards are matched by name and you choose the edition. Card names in non-Latin scripts rely on the collector line alone. Heavy foil glare on the bottom-left corner can defeat it. Lookups go to Scryfall; the OCR itself runs on the phone (Tesseract, engine and model cached after first use). Debug: set `localStorage['deckfoundry:scanDebug'] = '1'` to log raw OCR in `window.__scanLog`.
- **The "AI" builder is a local rules engine.** It uses synergy scoring, role quotas (ramp, draw, removal, wipes), mana-base selection, legality and budget checks, and generates its explanations from that data. `parsePrompt` in `builder.ts` is the natural-language layer, and an LLM can replace it as long as it returns a `BuildRequest`. That keeps the "only real cards" guarantee in the builder.
- **Longer price history** builds up from weekly `npm run fetch-market` runs. Cardmarket's public file only covers 30 days, and its full API needs an approved account.
- **Arena collections:** Arena exports decks, not your full collection. Collection trackers that read Arena usually export CSV, which the importer accepts.
- **Imported cards** that aren't in the bundled database are looked up on Scryfall and stored in the browser (IndexedDB).
- **Prices** come from the snapshot (Cardmarket EUR trend via Scryfall) and are refreshed by re-running `npm run fetch-cards`.
- There are no accounts or backend yet. `store.ts` is shaped so it can move to a per-user API later.
