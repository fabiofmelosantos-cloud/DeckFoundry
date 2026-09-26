import type { Deck } from './types'
import { buildDeck, experimentRequest, parsePrompt, type BuildRequest } from './builder'
import { getState, nextExperimentNumber, ownedMap, storeGenerated } from './store'

/** Runs the builder, persists the result so it has a stable URL, and returns it. */
export function generateFromPrompt(prompt: string, overrides: Partial<BuildRequest> = {}): Deck {
  const prefs = getState().prefs
  const req = { ...parsePrompt(prompt, prefs), ...overrides }
  const deck = buildDeck(req, ownedMap(), prefs)
  storeGenerated(deck)
  return deck
}

export function generateExperiment(surprise = false): Deck {
  const prefs = getState().prefs
  const seed = Date.now()
  const n = nextExperimentNumber()
  const req = experimentRequest(prefs, seed, surprise)
  let built: Deck
  try {
    built = buildDeck(req, ownedMap(), prefs)
  } catch {
    // No legendary creature owned yet — fall back to a 60-card experiment
    built = buildDeck({ ...req, kind: 'constructed' }, ownedMap(), prefs)
  }
  const deck = { ...built, experiment: n }
  deck.id = `lab-${n}-${seed.toString(36)}`
  storeGenerated(deck)
  return deck
}

export const THINKING_STEPS = ['Reading your collection', 'Checking colour identity & legality', 'Scoring synergies and combos', 'Balancing curve, removal & card draw', 'Building the mana base']
