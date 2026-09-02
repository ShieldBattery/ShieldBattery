import { createStore } from 'jotai'
import { beforeEach, describe, expect, test } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import {
  acceptedPlayersAtom,
  acceptRequestGenerationAtom,
  clearMatchmakingState,
  FoundMatch,
  foundMatchAtom,
  foundMatchGenerationAtom,
  hasAcceptedAtom,
} from './matchmaking-atoms'

function makeMatch(numPlayers = 2): FoundMatch {
  return {
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers,
    acceptStart: 0,
    acceptTimeTotalMillis: 30000,
    acceptedPlayers: 0,
    hasAccepted: false,
  }
}

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
})

describe('client/matchmaking/matchmaking-atoms/foundMatchGenerationAtom', () => {
  test('changes when a match is found and when it is cleared', () => {
    const initial = store.get(foundMatchGenerationAtom)

    store.set(foundMatchAtom, makeMatch())
    const whileMatched = store.get(foundMatchGenerationAtom)
    expect(whileMatched).not.toBe(initial)

    store.set(foundMatchAtom, undefined)
    expect(store.get(foundMatchGenerationAtom)).not.toBe(whileMatched)
  })

  test('changes when one match replaces another', () => {
    store.set(foundMatchAtom, makeMatch())
    const first = store.get(foundMatchGenerationAtom)

    store.set(foundMatchAtom, makeMatch())
    expect(store.get(foundMatchGenerationAtom)).not.toBe(first)
  })

  test('changes when matchmaking state is cleared wholesale', () => {
    store.set(foundMatchAtom, makeMatch())
    const whileMatched = store.get(foundMatchGenerationAtom)

    clearMatchmakingState(store)
    expect(store.get(foundMatchAtom)).toBeUndefined()
    expect(store.get(foundMatchGenerationAtom)).not.toBe(whileMatched)
  })

  test('stays put while the match that was found is updated in place', () => {
    store.set(foundMatchAtom, makeMatch())
    const generation = store.get(foundMatchGenerationAtom)

    store.set(acceptedPlayersAtom, 1)
    store.set(acceptRequestGenerationAtom, generation)
    store.set(hasAcceptedAtom, true)

    expect(store.get(acceptedPlayersAtom)).toBe(1)
    expect(store.get(hasAcceptedAtom)).toBe(true)
    expect(store.get(foundMatchGenerationAtom)).toBe(generation)
  })
})

describe('client/matchmaking/matchmaking-atoms/hasAcceptedAtom', () => {
  test('takes the result of an accept sent for the match being accepted', () => {
    store.set(foundMatchAtom, makeMatch())
    store.set(acceptRequestGenerationAtom, store.get(foundMatchGenerationAtom))

    store.set(hasAcceptedAtom, true)

    expect(store.get(hasAcceptedAtom)).toBe(true)
  })

  test('ignores the result of an accept sent for a match that has since been replaced', () => {
    store.set(foundMatchAtom, makeMatch())
    store.set(acceptRequestGenerationAtom, store.get(foundMatchGenerationAtom))
    // The match the accept was sent for dissolves, the client is requeued, and a new match is found
    // before the accept is answered.
    store.set(foundMatchAtom, undefined)
    store.set(foundMatchAtom, makeMatch())

    store.set(hasAcceptedAtom, true)

    expect(store.get(hasAcceptedAtom)).toBe(false)
  })

  test('ignores a result with no accept request behind it', () => {
    store.set(foundMatchAtom, makeMatch())

    store.set(hasAcceptedAtom, true)

    expect(store.get(hasAcceptedAtom)).toBe(false)
  })
})
