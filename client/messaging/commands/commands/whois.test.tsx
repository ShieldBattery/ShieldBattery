import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'
import { findUserByName } from '../../../users/action-creators'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { whoisCommand } from './whois'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the lookup the command reaches for is stubbed; the rest of the module stays real, since the
// command registry these run against pulls in every command's action creators.
vi.mock('../../../users/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../users/action-creators')>()),
  findUserByName: vi.fn(() => ({ type: 'TEST/findUserByName' })),
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
const TARGET_ID = makeSbUserId(2)

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: SELF_ID,
  members: [],
  canKick: false,
  canBan: false,
}

interface FakeChannel {
  id: number
  /** Left out for a channel whose info the client hasn't got, which the answer can't name. */
  name?: string
  hasLoadedUserList?: boolean
  active?: SbUserId[]
  idle?: SbUserId[]
  offline?: SbUserId[]
}

function makeState({
  channels = [],
  friends = [],
  friendStatus,
}: {
  channels?: FakeChannel[]
  friends?: SbUserId[]
  friendStatus?: FriendActivityStatus
}) {
  const idToUsers = new Map()
  const idToBasicInfo = new Map()
  for (const channel of channels) {
    const channelId = makeSbChannelId(channel.id)
    idToUsers.set(channelId, {
      active: new Set(channel.active ?? []),
      idle: new Set(channel.idle ?? []),
      offline: new Set(channel.offline ?? []),
      hasLoadedUserList: channel.hasLoadedUserList ?? true,
      loadingUserList: false,
    })
    if (channel.name !== undefined) {
      idToBasicInfo.set(channelId, { id: channelId, name: channel.name })
    }
  }

  return {
    chat: { idToUsers, idToBasicInfo },
    relationships: {
      friends: new Map(friends.map(id => [id, { toId: id }])),
      friendActivityStatus: new Map(
        friendStatus !== undefined ? friends.map(id => [id, friendStatus]) : [],
      ),
    },
    users: { byId: new Map([[SELF_ID, { id: SELF_ID, name: 'Marko', created: 0 }]]) },
  } as any
}

function runInput(input: string, state: unknown) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(dispatch, () => state)
    }
  })
  const result = runChatCommandWith([whoisCommand], input, {
    context: channelContext,
    dispatch,
    t,
    emit,
  })

  return { result, emit, dispatch }
}

/** Runs the command for a named user and resolves the lookup to `TARGET_ID`, as the server would. */
function runForTarget(state: unknown, name = 'tec27') {
  const run = runInput(`/whois ${name}`, state)

  expect(findUserByName).toHaveBeenCalledWith(name, expect.anything())
  asMockedFunction(findUserByName).mock.calls[0][1].onSuccess({
    id: TARGET_ID,
    name,
    created: 0,
  })

  return run
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/commands/whois', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('naming nobody answers for whoever ran it', () => {
    const { result, emit } = runInput(
      '/whois',
      makeState({ channels: [{ id: 1, name: 'foo', active: [SELF_ID] }] }),
    )

    expect(result).toEqual({ kind: 'command' })
    expect(findUserByName).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      'You are Marko. Channels: #foo (active).',
    )
  })

  test("a friend's activity says what they're doing", () => {
    const { emit } = runForTarget(
      makeState({
        channels: [{ id: 1, name: 'foo', active: [TARGET_ID] }],
        friends: [TARGET_ID],
        friendStatus: FriendActivityStatus.InGame,
      }),
    )

    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      'tec27 is in a game. Channels: #foo (active).',
    )
  })

  test('a friend with no activity reported yet is offline', () => {
    const { emit } = runForTarget(makeState({ friends: [TARGET_ID] }))

    expect(renderLine(emit.mock.calls[0][0].content)).toBe('tec27 is offline.')
  })

  test('someone who is not a friend is online if any shared channel has them around', () => {
    const { emit } = runForTarget(
      makeState({
        channels: [
          { id: 1, name: 'foo', active: [TARGET_ID] },
          { id: 2, name: 'bar', offline: [TARGET_ID] },
        ],
      }),
    )

    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      'tec27 is online. Channels: #foo (active), #bar (offline).',
    )
  })

  test('someone who is not a friend and offline everywhere is offline', () => {
    const { emit } = runForTarget(
      makeState({ channels: [{ id: 1, name: 'foo', idle: [SELF_ID], offline: [TARGET_ID] }] }),
    )

    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      'tec27 is offline. Channels: #foo (offline).',
    )
  })

  test('nothing is said about someone no shared channel accounts for', () => {
    const { emit } = runForTarget(makeState({ channels: [{ id: 1, name: 'foo' }] }))

    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      "Can't tell what tec27 is doing: only friends and members of your channels share their status.",
    )
  })

  test('a channel whose member list has not loaded says nothing either way', () => {
    const { emit } = runForTarget(
      makeState({
        channels: [
          { id: 1, name: 'foo', hasLoadedUserList: false, active: [TARGET_ID] },
          { id: 2, active: [TARGET_ID] },
        ],
      }),
    )

    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      "Can't tell what tec27 is doing: only friends and members of your channels share their status.",
    )
  })
})
