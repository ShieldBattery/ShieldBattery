import { act, fireEvent, render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { UserRelationshipServiceErrorCode } from '../../../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'
import { FetchError } from '../../../network/fetch-errors'
import { blockUser, unblockUser } from '../../../social/action-creators'
import { findUserByName } from '../../../users/action-creators'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { blockCommand, unblockCommand } from './block'

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
  blockUser: vi.fn(() => ({ type: 'TEST/blockUser' })),
  unblockUser: vi.fn(() => ({ type: 'TEST/unblockUser' })),
}))

// `ConnectedUsername` needs a Redux Provider to render for real, so it is stood in for with a plain
// text lookup against the fixture's own id-to-name mappings.
const { userNames } = vi.hoisted(() => ({ userNames: new Map<number, string>() }))

vi.mock('../../../users/connected-username', () => ({
  ConnectedUsername: ({ userId }: { userId: number }) => userNames.get(userId),
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

userNames.set(SELF_ID, 'Marko')
userNames.set(TARGET_ID, 'tec27')

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: SELF_ID,
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

function makeState({ loaded = true, blocks = [] }: { loaded?: boolean; blocks?: SbUserId[] } = {}) {
  return {
    relationships: {
      loaded,
      friends: new Map(),
      blocks: new Map(blocks.map(id => [id, { toId: id }])),
      incomingRequests: new Map(),
      outgoingRequests: new Map(),
      friendActivityStatus: new Map(),
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
  const result = runChatCommandWith([blockCommand, unblockCommand], input, {
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

/** Builds the error a refused request hands back, carrying the code the server answered with. */
function fetchErrorWithCode(code: string): FetchError {
  const bodyText = JSON.stringify({ code })
  return new FetchError(new Response(bodyText, { status: 409, statusText: 'Conflict' }), bodyText)
}

describe('messaging/commands/commands/block', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('/block blocks the user and offers to undo it', () => {
    const { result, emit } = runForTarget('/block tec27')

    expect(result).toEqual({ kind: 'command' })
    expect(blockUser).toHaveBeenCalledWith(TARGET_ID, expect.anything())

    asMockedFunction(blockUser).mock.calls[0][1].onSuccess()
    const line = emit.mock.calls[0][0]
    expect(line.kind).toBe('info')

    const { container } = render(<div>{line.content}</div>)
    expect(container.textContent).toBe(
      'Blocked tec27. Their messages are hidden here and in any game you launch from now on. Undo',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(unblockUser).toHaveBeenCalledWith(TARGET_ID, expect.anything())

    act(() => asMockedFunction(unblockUser).mock.calls[0][1].onSuccess())
    expect(container.textContent).toBe('Unblocked tec27.')
  })

  test('/block says so when the user is already blocked', () => {
    const { emit } = runForTarget('/block tec27', makeState({ blocks: [TARGET_ID] }))

    expect(blockUser).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('tec27 is already blocked.')
  })

  test('/block refuses to name the user running it', () => {
    const { emit } = runForTarget('/block Marko', undefined, SELF_ID)

    expect(blockUser).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(emit.mock.calls[0][0].content).toBe("You can't block yourself.")
  })

  test('/block carries the block limit the server refused it with', () => {
    const { emit } = runForTarget('/block tec27')

    asMockedFunction(blockUser).mock.calls[0][1].onError(
      fetchErrorWithCode(UserRelationshipServiceErrorCode.LimitReached),
    )

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      "You've reached the maximum of 150 blocked users.",
    )
  })

  test('/unblock unblocks the user and offers to undo it', () => {
    const { emit } = runForTarget('/unblock tec27', makeState({ blocks: [TARGET_ID] }))

    expect(unblockUser).toHaveBeenCalledWith(TARGET_ID, expect.anything())
    asMockedFunction(unblockUser).mock.calls[0][1].onSuccess()

    const { container } = render(<div>{emit.mock.calls[0][0].content}</div>)
    expect(container.textContent).toBe('Unblocked tec27. Undo')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(blockUser).toHaveBeenCalledWith(TARGET_ID, expect.anything())

    act(() => asMockedFunction(blockUser).mock.calls[0][1].onSuccess())
    expect(container.textContent).toBe('Blocked tec27 again.')
  })

  test('/unblock says so when the user is not blocked', () => {
    const { emit } = runForTarget('/unblock tec27')

    expect(unblockUser).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe("tec27 isn't blocked.")
  })

  test('/unblock refuses to name the user running it', () => {
    const { emit } = runForTarget('/unblock Marko', undefined, SELF_ID)

    expect(unblockUser).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].content).toBe("You can't unblock yourself.")
  })

  test('the aliases reach the command they belong to', () => {
    for (const input of ['/ignore tec27', '/squelch tec27']) {
      vi.clearAllMocks()
      runForTarget(input)

      expect(blockUser).toHaveBeenCalledWith(TARGET_ID, expect.anything())
    }
  })
})
