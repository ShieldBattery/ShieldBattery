import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { retrieveUserList } from '../../../chat/action-creators'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { whoCommand } from './who'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the member-list request the command reaches for is stubbed; the rest of the module stays
// real, since the command registry these run against pulls in every command's action creators.
vi.mock('../../../chat/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../chat/action-creators')>()),
  retrieveUserList: vi.fn(() => ({ type: 'TEST/retrieveUserList' })),
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
const FOO_ID = makeSbChannelId(1)
const BAR_ID = makeSbChannelId(2)

const ALICE = makeSbUserId(2)
const BOB = makeSbUserId(3)
const CAROL = makeSbUserId(4)

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: FOO_ID,
  selfUserId: SELF_ID,
  members: [],
  canKick: false,
  canBan: false,
}

function makeState({
  active = [],
  idle = [],
  offline = [],
}: {
  active?: ReturnType<typeof makeSbUserId>[]
  idle?: ReturnType<typeof makeSbUserId>[]
  offline?: ReturnType<typeof makeSbUserId>[]
} = {}) {
  return {
    chat: {
      // `bar` is known about but not joined, which is as far as the command goes for it.
      idToBasicInfo: new Map([
        [FOO_ID, { id: FOO_ID, name: 'foo' }],
        [BAR_ID, { id: BAR_ID, name: 'bar' }],
      ]),
      joinedChannels: new Set([FOO_ID]),
      idToUsers: new Map([
        [
          FOO_ID,
          {
            active: new Set(active),
            idle: new Set(idle),
            offline: new Set(offline),
            hasLoadedUserList: true,
            loadingUserList: false,
          },
        ],
      ]),
    },
    users: {
      byId: new Map([
        [SELF_ID, { id: SELF_ID, name: 'Marko', created: 0 }],
        [ALICE, { id: ALICE, name: 'Alice', created: 0 }],
        [BOB, { id: BOB, name: 'bob', created: 0 }],
        [CAROL, { id: CAROL, name: 'Carol', created: 0 }],
      ]),
    },
  } as any
}

function runInput(input: string, state: unknown) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(dispatch, () => state)
    }
  })
  const result = runChatCommandWith([whoCommand], input, {
    context: channelContext,
    dispatch,
    t,
    emit,
  })

  return { result, emit, dispatch }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/commands/who', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('a channel that has not been joined answers with an error line', () => {
    const { result, emit } = runInput('/who bar', makeState())

    expect(result).toEqual({ kind: 'command' })
    expect(retrieveUserList).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe("You aren't in #bar.")
  })

  test('a channel nothing is known about answers the same way', () => {
    const { emit } = runInput('/who nope', makeState())

    expect(renderLine(emit.mock.calls[0][0].content)).toBe("You aren't in #nope.")
  })

  test('names who is around and counts who is not', () => {
    const { emit } = runInput(
      '/who foo',
      makeState({ active: [BOB], idle: [ALICE], offline: [CAROL] }),
    )

    expect(emit).not.toHaveBeenCalled()
    expect(retrieveUserList).toHaveBeenCalledWith(FOO_ID, expect.anything())

    asMockedFunction(retrieveUserList).mock.calls[0][1].onSuccess(undefined)

    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      'Users in #foo (2 online, 1 offline): Alice, bob',
    )
  })

  test.each(['/who FOO', '/who #foo'])(
    'the channel name is matched without regard to case, with or without its hash (%s)',
    input => {
      const { emit } = runInput(input, makeState({ active: [ALICE] }))

      asMockedFunction(retrieveUserList).mock.calls[0][1].onSuccess(undefined)

      expect(renderLine(emit.mock.calls[0][0].content)).toBe(
        'Users in #foo (1 online, 0 offline): Alice',
      )
    },
  )

  test('a channel with nobody around ends after the counts', () => {
    const { emit } = runInput('/who foo', makeState({ offline: [ALICE, CAROL] }))

    asMockedFunction(retrieveUserList).mock.calls[0][1].onSuccess(undefined)

    expect(renderLine(emit.mock.calls[0][0].content)).toBe('Users in #foo (0 online, 2 offline).')
  })

  test('a member list that could not be loaded answers with an error line', () => {
    const { emit } = runInput('/who foo', makeState())

    asMockedFunction(retrieveUserList).mock.calls[0][1].onError(new Error('boom'))

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe("Couldn't load who is in #foo: boom")
  })

  test('only the joined channels are offered for completion', () => {
    const state = makeState()
    const suggestions = whoCommand.args[0].suggest?.({
      context: channelContext,
      getState: () => state,
    })

    expect(suggestions).toEqual([{ value: 'foo' }])
  })
})
