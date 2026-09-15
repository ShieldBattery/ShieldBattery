import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { jotaiStore } from '../../../jotai-store'
import { FetchError } from '../../../network/fetch-errors'
import { RootState } from '../../../root-reducer'
import { sendMessage as sendWhisperMessage } from '../../../whispers/action-creators'
import { lastWhisperSenderAtom } from '../../../whispers/whisper-atoms'
import { ChannelCommandContext } from '../command-context'
import { ReplyTarget } from '../command-schema'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { matchReplyCommand, replyCommand, resolveReplyTarget } from './reply'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// The command reads who whispered last straight out of the Jotai store. A store of this test's own
// stands in for the app's, so each test can decide who there is to reply to.
vi.mock('../../../jotai-store', async () => {
  const { createStore } = await import('jotai')
  return { jotaiStore: createStore() }
})

// Only the send the command reaches for is stubbed; the rest of the module stays real, since the
// command registry these run against pulls in every command's action creators.
vi.mock('../../../whispers/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../whispers/action-creators')>()),
  sendMessage: vi.fn(() => ({ type: 'TEST/whisperSend' })),
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

// Answers with whatever default value the caller supplied, which is what the real translations
// hold for English anyway.
const t = ((key: string, options?: string | { defaultValue?: string }) =>
  typeof options === 'string' ? options : (options?.defaultValue ?? key)) as unknown as TFunction

const SELF_ID = makeSbUserId(1)
const SENDER_ID = makeSbUserId(2)
const STRANGER_ID = makeSbUserId(3)

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: SELF_ID,
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

/** A store holding the users the client would know the names of. */
function makeState(
  users: Array<{ id: SbUserId; name: string }> = [{ id: SENDER_ID, name: 'tec27' }],
) {
  return {
    users: { byId: new Map(users.map(user => [user.id, { ...user, created: 0 }])) },
  } as any as RootState
}

function runInput(
  input: string,
  {
    state = makeState(),
    enterReplyMode,
  }: { state?: RootState; enterReplyMode?: (target: ReplyTarget) => void } = {},
) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn((action: unknown) => {
    if (typeof action === 'function') {
      ;(action as (d: unknown, getState: () => RootState) => void)(dispatch, () => state)
    }
  })

  const result = runChatCommandWith([replyCommand], input, {
    context: channelContext,
    dispatch: dispatch as any,
    t,
    emit,
    enterReplyMode,
  })

  return { result, emit, dispatch }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

/** Builds the error a failed send hands back, carrying the code the server answered with. */
function fetchErrorWithCode(code: string): FetchError {
  const bodyText = JSON.stringify({ code })
  return new FetchError(new Response(bodyText, { status: 403, statusText: 'Forbidden' }), bodyText)
}

const NO_TARGET_LINE = "No one has whispered you yet, so there's no one to reply to."

describe('messaging/commands/commands/reply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jotaiStore.set(lastWhisperSenderAtom, undefined)
  })

  describe('matchReplyCommand', () => {
    test('the name and its alias, with nothing after them', () => {
      expect(matchReplyCommand('/r')).toEqual({ hasSeparator: false, rest: '' })
      expect(matchReplyCommand('/reply')).toEqual({ hasSeparator: false, rest: '' })
    })

    test('a message after the name', () => {
      expect(matchReplyCommand('/R hi')).toEqual({ hasSeparator: true, rest: 'hi' })
      expect(matchReplyCommand('/r hi there')).toEqual({ hasSeparator: true, rest: 'hi there' })
      expect(matchReplyCommand('/reply ')).toEqual({ hasSeparator: true, rest: '' })
    })

    test('leading whitespace is skipped, the way submitting skips it', () => {
      expect(matchReplyCommand(' /r x')).toEqual({ hasSeparator: true, rest: 'x' })
    })

    test('anything that is not this command', () => {
      expect(matchReplyCommand('/re')).toBeUndefined()
      expect(matchReplyCommand('/rank')).toBeUndefined()
      expect(matchReplyCommand('//r')).toBeUndefined()
      expect(matchReplyCommand('r')).toBeUndefined()
      expect(matchReplyCommand('hey /r')).toBeUndefined()
      expect(matchReplyCommand('')).toBeUndefined()
    })
  })

  describe('resolveReplyTarget', () => {
    test('nobody has whispered', () => {
      expect(resolveReplyTarget(makeState())).toBeUndefined()
    })

    test('the last sender, once the client knows their name', () => {
      jotaiStore.set(lastWhisperSenderAtom, SENDER_ID)

      expect(resolveReplyTarget(makeState())).toEqual({ id: SENDER_ID, name: 'tec27' })
    })

    test('a sender the client has no name for', () => {
      jotaiStore.set(lastWhisperSenderAtom, STRANGER_ID)

      expect(resolveReplyTarget(makeState())).toBeUndefined()
    })
  })

  test('a reply before anyone has whispered sends nothing and says so', () => {
    const enterReplyMode = vi.fn()
    const { result, emit } = runInput('/r hello', { enterReplyMode })

    expect(result).toEqual({ kind: 'command' })
    expect(sendWhisperMessage).not.toHaveBeenCalled()
    expect(enterReplyMode).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(emit.mock.calls[0][0].content).toBe(NO_TARGET_LINE)
  })

  test('a reply with a message whispers it to the last sender', () => {
    jotaiStore.set(lastWhisperSenderAtom, SENDER_ID)

    const { emit, dispatch } = runInput('/reply hi there')

    expect(emit).not.toHaveBeenCalled()
    expect(sendWhisperMessage).toHaveBeenCalledWith(SENDER_ID, 'hi there', expect.anything())
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/whisperSend' })
  })

  test('a reply with no message puts the input into reply mode', () => {
    jotaiStore.set(lastWhisperSenderAtom, SENDER_ID)
    const enterReplyMode = vi.fn()

    const { emit } = runInput('/r', { enterReplyMode })

    expect(emit).not.toHaveBeenCalled()
    expect(sendWhisperMessage).not.toHaveBeenCalled()
    expect(enterReplyMode).toHaveBeenCalledWith({ id: SENDER_ID, name: 'tec27' })
  })

  test('a chat restriction answers with a line saying so', () => {
    jotaiStore.set(lastWhisperSenderAtom, SENDER_ID)

    const { emit } = runInput('/r hello')
    const spec = asMockedFunction(sendWhisperMessage).mock.calls[0][2]

    spec.onError(fetchErrorWithCode(WhisperServiceErrorCode.UserChatRestricted))

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      "You're currently restricted from sending chat messages.",
    )
  })

  test('any other failure answers with the error it carried', () => {
    jotaiStore.set(lastWhisperSenderAtom, SENDER_ID)

    const { emit } = runInput('/r hello')
    const spec = asMockedFunction(sendWhisperMessage).mock.calls[0][2]

    spec.onError(new Error('everything is on fire'))

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toContain(
      "Couldn't send your reply to tec27: everything is on fire",
    )
  })
})
