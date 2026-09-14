import { render } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { MatchmakingServiceErrorCode, MatchmakingType } from '../../../../common/matchmaking'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { jotaiStore } from '../../../jotai-store'
import { cancelFindMatch } from '../../../matchmaking/action-creators'
import { currentSearchInfoAtom, foundMatchAtom } from '../../../matchmaking/matchmaking-atoms'
import { FetchError } from '../../../network/fetch-errors'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { cancelCommand } from './cancel'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// The command reads the search state straight out of the Jotai store. A store of this test's own
// stands in for the app's, so each test can put the search in whatever state it is about; it's a
// real store, since the matchmaking module writes to it as it loads.
vi.mock('../../../jotai-store', async () => {
  const { createStore } = await import('jotai')
  return { jotaiStore: createStore() }
})

// Only the request the command reaches for is stubbed; the rest of the module stays real, since the
// command registry these run against pulls in every command's action creators.
vi.mock('../../../matchmaking/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../matchmaking/action-creators')>()),
  cancelFindMatch: vi.fn(() => ({ type: 'TEST/cancelFindMatch' })),
}))

// The command layer builds its lines with `Trans`, which needs an i18next instance to render
// against even though every line hands it a `t` of its own. `escapeValue` matches how the app
// initializes i18next: React escapes what it renders, so escaping again would put entities on
// screen in place of the angle brackets and slashes these lines are made of.
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

// Answers with whatever default value the caller supplied, with the values it was handed filled
// into it, which is what the real translations hold for English anyway.
const t = ((key: string, options?: string | { defaultValue?: string; [name: string]: unknown }) => {
  if (typeof options === 'string') {
    return options
  }

  // Only the values handed in are filled in: a `Trans` line's placeholders stand for its own
  // children and are substituted after this hands the string back, so they have to survive it.
  const text = options?.defaultValue ?? key
  return text.replace(/{{(\w+)}}/g, (placeholder, name: string) =>
    options?.[name] !== undefined ? String(options[name]) : placeholder,
  )
}) as unknown as TFunction

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: makeSbUserId(1),
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

function setSearchState({ searching, matched = false }: { searching: boolean; matched?: boolean }) {
  jotaiStore.set(
    currentSearchInfoAtom,
    searching ? { searchedTypes: new Map(), startTime: 0 } : undefined,
  )
  jotaiStore.set(
    foundMatchAtom,
    matched
      ? {
          matchmakingType: MatchmakingType.Match1v1,
          numPlayers: 2,
          acceptStart: 0,
          acceptTimeTotalMillis: 60000,
          acceptedPlayers: 1,
          hasAccepted: false,
        }
      : undefined,
  )
}

function runInput(input: string) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn()
  const result = runChatCommandWith([cancelCommand], input, {
    context: channelContext,
    dispatch,
    t,
    emit,
  })

  return { result, emit, dispatch }
}

function renderLine(content: React.ReactNode): string {
  const { container } = render(<div>{content}</div>)
  return container.textContent ?? ''
}

/** Builds the error a refused request hands back, carrying the code the server answered with. */
function fetchErrorWithCode(code: string): FetchError {
  const bodyText = JSON.stringify({ code })
  return new FetchError(new Response(bodyText, { status: 409, statusText: 'Conflict' }), bodyText)
}

describe('messaging/commands/commands/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('a search that is running is called off', () => {
    setSearchState({ searching: true })
    const { result, emit } = runInput('/cancel')

    expect(result).toEqual({ kind: 'command' })
    expect(cancelFindMatch).toHaveBeenCalledTimes(1)

    asMockedFunction(cancelFindMatch).mock.calls[0][0].onSuccess()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(emit.mock.calls[0][0].content).toBe('Matchmaking search cancelled.')
  })

  test('with no search running, nothing is sent', () => {
    setSearchState({ searching: false })
    const { emit } = runInput('/cancel')

    expect(cancelFindMatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(emit.mock.calls[0][0].content).toBe("You aren't searching for a match.")
  })

  test('a match that has already been found is not called off', () => {
    setSearchState({ searching: true, matched: true })
    const { emit } = runInput('/cancel')

    expect(cancelFindMatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(emit.mock.calls[0][0].content).toBe(
      "A match has already been found, so the search can't be cancelled.",
    )
  })

  test('a search the server says is gone reads as not searching', () => {
    setSearchState({ searching: true })
    const { emit } = runInput('/cancel')

    asMockedFunction(cancelFindMatch).mock.calls[0][0].onError(
      fetchErrorWithCode(MatchmakingServiceErrorCode.NotInQueue),
    )

    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(emit.mock.calls[0][0].content).toBe("You aren't searching for a match.")
  })

  test('a cancel that failed some other way carries the error it came with', () => {
    setSearchState({ searching: true })
    const { emit } = runInput('/cancel')

    asMockedFunction(cancelFindMatch).mock.calls[0][0].onError(new Error('the server is on fire'))

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      "Couldn't cancel the search: the server is on fire",
    )
  })
})
