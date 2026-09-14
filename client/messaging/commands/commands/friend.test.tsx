import { act, fireEvent, render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'
import {
  acceptFriendRequest,
  getRelationshipsIfNeeded,
  removeFriend,
  sendFriendRequest,
} from '../../../social/action-creators'
import { findUserByName } from '../../../users/action-creators'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { friendsCommand } from './friend'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// The store the commands read and the dispatch they hand their thunks to. The emitted lines reach
// the same dispatch through the Redux hook, which is stood in for below rather than wrapping every
// render in a real store.
const { store } = vi.hoisted(() => {
  const store: { state: any; dispatch: any } = { state: undefined, dispatch: undefined }
  store.dispatch = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(store.dispatch, () => store.state)
    }
  })
  return { store }
})

vi.mock('../../../redux-hooks', () => ({
  useAppDispatch: () => store.dispatch,
  useAppSelector: () => undefined,
}))

// Only the requests the commands reach for are stubbed; the rest of each module stays real, since
// the command registry these run against pulls in every command's action creators.
vi.mock('../../../users/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../users/action-creators')>()),
  findUserByName: vi.fn(() => ({ type: 'TEST/findUserByName' })),
}))

vi.mock('../../../social/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../social/action-creators')>()),
  sendFriendRequest: vi.fn(() => ({ type: 'TEST/sendFriendRequest' })),
  acceptFriendRequest: vi.fn(() => ({ type: 'TEST/acceptFriendRequest' })),
  removeFriend: vi.fn(() => ({ type: 'TEST/removeFriend' })),
  getRelationshipsIfNeeded: vi.fn(() => ({ type: 'TEST/getRelationshipsIfNeeded' })),
}))

// `ConnectedUsername` needs a Redux Provider to render for real, so it is stood in for with a plain
// text lookup against the fixture's own id-to-name mappings.
const { userNames, activityStatus } = vi.hoisted(() => ({
  userNames: new Map<number, string>(),
  activityStatus: new Map<number, string>(),
}))

vi.mock('../../../users/connected-username', () => ({
  ConnectedUsername: ({ userId }: { userId: number }) => userNames.get(userId),
}))

vi.mock('../../../social/friend-activity-status', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../social/friend-activity-status')>()),
  useFriendActivityStatus: (userId: number) => activityStatus.get(userId),
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
const ALICE_ID = makeSbUserId(3)
const BOB_ID = makeSbUserId(4)
const CAROL_ID = makeSbUserId(5)

userNames.set(SELF_ID, 'Marko')
userNames.set(TARGET_ID, 'tec27')
userNames.set(ALICE_ID, 'Alice')
userNames.set(BOB_ID, 'bob')
userNames.set(CAROL_ID, 'Carol')

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: SELF_ID,
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

function makeState({
  loaded = true,
  friends = [],
  incomingRequests = [],
  outgoingRequests = [],
  statuses = new Map<SbUserId, FriendActivityStatus>(),
}: {
  loaded?: boolean
  friends?: SbUserId[]
  incomingRequests?: SbUserId[]
  outgoingRequests?: SbUserId[]
  statuses?: Map<SbUserId, FriendActivityStatus>
} = {}) {
  return {
    relationships: {
      loaded,
      friends: new Map(friends.map(id => [id, { toId: id }])),
      blocks: new Map(),
      incomingRequests: new Map(incomingRequests.map(id => [id, { fromId: id }])),
      outgoingRequests: new Map(outgoingRequests.map(id => [id, { toId: id }])),
      friendActivityStatus: new Map(
        friends.map(id => [id, statuses.get(id) ?? FriendActivityStatus.Offline]),
      ),
    },
    users: {
      byId: new Map(
        Array.from(userNames.entries()).map(([id, name]) => [id, { id, name, created: 0 }]),
      ),
    },
  } as any
}

function runInput(input: string, state: unknown = makeState()) {
  store.state = state
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const result = runChatCommandWith([friendsCommand], input, {
    context: channelContext,
    dispatch: store.dispatch,
    t,
    emit,
  })

  return { result, emit }
}

/** Runs the command for a named user and resolves the lookup to `userId`, as the server would. */
function runForTarget(input: string, state?: unknown, userId: SbUserId = TARGET_ID) {
  const run = runInput(input, state)

  expect(findUserByName).toHaveBeenCalledTimes(1)
  const [name, spec] = asMockedFunction(findUserByName).mock.calls[0]
  spec.onSuccess({ id: userId, name, created: 0 })

  return run
}

function renderLine(content: React.ReactNode): string {
  const { container } = render(<div>{content}</div>)
  return container.textContent ?? ''
}

describe('messaging/commands/commands/friend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activityStatus.clear()
  })

  test('/f add sends a friend request', () => {
    const { result, emit } = runForTarget('/f add tec27')

    expect(result).toEqual({ kind: 'command' })
    expect(sendFriendRequest).toHaveBeenCalledWith(TARGET_ID, expect.anything())

    asMockedFunction(sendFriendRequest).mock.calls[0][1].onSuccess()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('Friend request sent to tec27.')
  })

  test('/f add accepts a request that is already waiting', () => {
    const { emit } = runForTarget('/f add tec27', makeState({ incomingRequests: [TARGET_ID] }))

    expect(sendFriendRequest).not.toHaveBeenCalled()
    expect(acceptFriendRequest).toHaveBeenCalledWith(TARGET_ID, expect.anything())

    asMockedFunction(acceptFriendRequest).mock.calls[0][1].onSuccess()
    expect(renderLine(emit.mock.calls[0][0].content)).toBe("You're now friends with tec27.")
  })

  test('/f add says so when the friendship already exists', () => {
    const { emit } = runForTarget('/f add tec27', makeState({ friends: [TARGET_ID] }))

    expect(sendFriendRequest).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe("You're already friends with tec27.")
  })

  test('/f add says so when a request has already been sent', () => {
    const { emit } = runForTarget('/f add tec27', makeState({ outgoingRequests: [TARGET_ID] }))

    expect(sendFriendRequest).not.toHaveBeenCalled()
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      "You've already sent tec27 a friend request.",
    )
  })

  test('/f add refuses to name the user running it', () => {
    const { emit } = runForTarget('/f add Marko', undefined, SELF_ID)

    expect(sendFriendRequest).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(emit.mock.calls[0][0].content).toBe("You can't send yourself a friend request.")
  })

  test('/f add asks the server when the relationships have not loaded', () => {
    runForTarget('/f add tec27', makeState({ loaded: false, friends: [TARGET_ID] }))

    expect(sendFriendRequest).toHaveBeenCalledWith(TARGET_ID, expect.anything())
  })

  test('/f add and its alias reach the same routine', () => {
    for (const input of ['/f add tec27', '/f a tec27']) {
      vi.clearAllMocks()
      runForTarget(input)

      expect(sendFriendRequest).toHaveBeenCalledWith(TARGET_ID, expect.anything())
    }
  })

  test('/f remove and its alias reach the same routine', () => {
    for (const input of ['/f remove tec27', '/f r tec27']) {
      vi.clearAllMocks()
      runForTarget(input, makeState({ friends: [TARGET_ID] }))

      expect(removeFriend).toHaveBeenCalledWith(TARGET_ID, expect.anything())
    }
  })

  test('/f remove removes the friend and offers to undo it', () => {
    const { emit } = runForTarget('/f remove tec27', makeState({ friends: [TARGET_ID] }))

    expect(removeFriend).toHaveBeenCalledWith(TARGET_ID, expect.anything())
    asMockedFunction(removeFriend).mock.calls[0][1].onSuccess()

    const line = emit.mock.calls[0][0]
    expect(line.kind).toBe('info')
    const { container } = render(<div>{line.content}</div>)
    expect(container.textContent).toBe('Removed tec27 from your friends. Undo')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(sendFriendRequest).toHaveBeenCalledWith(TARGET_ID, expect.anything())

    act(() => asMockedFunction(sendFriendRequest).mock.calls[0][1].onSuccess())
    expect(container.textContent).toBe('Friend request sent to tec27.')
  })

  test('/f remove says so when the user is not a friend', () => {
    const { emit } = runForTarget('/f remove tec27')

    expect(removeFriend).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe("tec27 isn't on your friends list.")
  })

  test('/f list with no friends says the list is empty', () => {
    const { emit } = runInput('/f list')

    expect(getRelationshipsIfNeeded).toHaveBeenCalledTimes(1)
    asMockedFunction(getRelationshipsIfNeeded).mock.calls[0][0].onSuccess()

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(emit.mock.calls[0][0].content).toBe('Your friends list is empty.')
  })

  test('/f l lists the friends, online ones first and each group by name', () => {
    activityStatus.set(ALICE_ID, FriendActivityStatus.InGame)
    activityStatus.set(BOB_ID, FriendActivityStatus.Online)
    activityStatus.set(CAROL_ID, FriendActivityStatus.Offline)

    const { emit } = runInput(
      '/f l',
      makeState({
        friends: [CAROL_ID, BOB_ID, ALICE_ID],
        statuses: new Map([
          [ALICE_ID, FriendActivityStatus.InGame],
          [BOB_ID, FriendActivityStatus.Online],
          [CAROL_ID, FriendActivityStatus.Offline],
        ]),
      }),
    )

    asMockedFunction(getRelationshipsIfNeeded).mock.calls[0][0].onSuccess()

    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('Friends (2 online, 1 offline):')

    const card = emit.mock.calls[1][0]
    expect(card.kind).toBe('card')
    expect((card.content as React.ReactElement<{ userIds: SbUserId[] }>).props.userIds).toEqual([
      ALICE_ID,
      BOB_ID,
      CAROL_ID,
    ])
    // The rows carry the names in order; only the friend in a game says what they are doing.
    const text = renderLine(card.content)
    expect(text).toContain('Alice')
    expect(text).toContain('In game')
    expect(text).toContain('Carol')
  })

  test('/f rejects an action it does not have', () => {
    const { emit } = runInput('/f x')

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      'Invalid <action>: "x". Usage: /f <add|remove|list>',
    )
  })
})
