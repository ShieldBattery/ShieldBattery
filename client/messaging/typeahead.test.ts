import { describe, expect, test } from 'vitest'
import { matchTypeahead, TypeaheadMatch, TypeaheadProvider } from './typeahead'

function provider(id: string, match: (text: string) => TypeaheadMatch | undefined) {
  return { id, match } satisfies TypeaheadProvider
}

const emptyMatch: TypeaheadMatch = { start: 0, matchedText: '', suggestions: [] }

describe('messaging/typeahead/matchTypeahead', () => {
  test('the first provider to claim the caret wins', () => {
    const first = provider('first', text => (text.startsWith('/') ? emptyMatch : undefined))
    const second = provider('second', () => ({ ...emptyMatch, matchedText: 'second' }))

    expect(matchTypeahead([first, second], '/kick')).toEqual({ provider: first, match: emptyMatch })
  })

  test('a provider that passes lets the next one answer', () => {
    const first = provider('first', text => (text.startsWith('/') ? emptyMatch : undefined))
    const second = provider('second', () => ({ ...emptyMatch, matchedText: 'second' }))

    expect(matchTypeahead([first, second], 'hello')?.provider).toBe(second)
  })

  test('claiming with no rows still wins', () => {
    const first = provider('first', () => emptyMatch)
    const second = provider('second', () => ({ ...emptyMatch, matchedText: 'second' }))

    expect(matchTypeahead([first, second], 'anything')?.provider).toBe(first)
  })

  test('nothing claims the caret', () => {
    expect(matchTypeahead([provider('first', () => undefined)], 'hello')).toBeUndefined()
    expect(matchTypeahead([], 'hello')).toBeUndefined()
  })
})
