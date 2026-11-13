import { render } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../../common/games/game-type'
import { Lobby } from '../../../../common/lobbies'
import { InviteToLobbyErrorCode } from '../../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../../common/lobbies/sb-lobby-id'
import { createHuman } from '../../../../common/lobbies/slot'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'
import { inviteToLobby } from '../../../lobbies/action-creators'
import { FetchError } from '../../../network/fetch-errors'
import { findUserByName } from '../../../users/action-creators'
import { LobbyCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { inviteCommand } from './invite-to-lobby'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the request the command reaches for is stubbed; the rest of the module stays real, since
// `resolveTarget` and the lobby error helper share the modules this one pulls in.
vi.mock('../../../lobbies/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lobbies/action-creators')>()),
  inviteToLobby: vi.fn(() => ({ type: 'TEST/inviteToLobby' })),
}))

vi.mock('../../../users/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../users/action-creators')>()),
  findUserByName: vi.fn(() => ({ type: 'TEST/findUserByName' })),
}))

// `ConnectedUsername` needs a Redux Provider to render for real, so it is stood in for with a plain
// text lookup against the fixture's own id-to-name mappings.
const { userNames } = vi.hoisted(() => ({ userNames: new Map<number, string>() }))

vi.mock('../../../users/connected-username', () => ({
  ConnectedUsername: ({ userId }: { userId: number }) => userNames.get(userId),
}))

// The store the command reads and the dispatch it hands its thunks to.
const { store } = vi.hoisted(() => {
  const store: { state: any; dispatch: any } = { state: undefined, dispatch: undefined }
  store.dispatch = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(store.dispatch, () => store.state)
    }
  })
  return { store }
})

// The invited-line is built with `Trans`, which needs an i18next instance to render against.
// `escapeValue` matches how the app initializes i18next: React escapes what it renders, so
// escaping again would put entities on screen in place of the punctuation the line is made of.
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
const SEATED_ID = makeSbUserId(3)
const BENCHED_ID = makeSbUserId(4)
const FREE_ID = makeSbUserId(5)

userNames.set(SELF_ID, 'Marko')
userNames.set(TARGET_ID, 'tec27')
userNames.set(SEATED_ID, 'Alice')
userNames.set(BENCHED_ID, 'bob')
userNames.set(FREE_ID, 'Carol')

const lobbyContext: LobbyCommandContext = {
  surface: 'lobby',
  selfUserId: SELF_ID,
  members: [],
}

/** Builds a lobby whose only members are whoever `memberIds` names. */
function makeLobby(memberIds: SbUserId[] = []): Lobby {
  const host = createHuman(SELF_ID)
  return {
    id: makeSbLobbyId('aaaaaaaaaaaaaaaaaaaaaa'),
    name: 'Test Lobby',
    mapQueue: [],
    gameType: GameType.Melee,
    gameSubType: 0,
    teams: [
      {
        name: 'Team 1',
        teamId: 1,
        isObserver: false,
        slots: [host, ...memberIds.map(id => createHuman(id))],
        hiddenSlots: [],
      },
    ],
    bench: [],
    host,
    useLegacyLimits: false,
    starcraftCompatibleReplays: false,
    lockedAlliances: false,
    visibility: 'listed',
    createdAt: 0,
  }
}

/** The slice of store state the command and its argument suggestions read. */
function makeState({
  friends = [],
  lobbyMembers = [],
}: {
  friends?: SbUserId[]
  lobbyMembers?: SbUserId[]
} = {}) {
  return {
    users: {
      byId: new Map(
        Array.from(userNames.entries()).map(([id, name]) => [id, { id, name, created: 0 }]),
      ),
    },
    relationships: {
      friends: new Map(friends.map(id => [id, { toId: id }])),
      friendActivityStatus: new Map(friends.map(id => [id, FriendActivityStatus.Online])),
      blocks: new Map(),
    },
    whispers: { sessions: [] },
    lobby: { info: makeLobby(lobbyMembers) },
  } as any
}

function runInput(input: string, state: unknown = makeState()) {
  store.state = state
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const result = runChatCommandWith([inviteCommand], input, {
    context: lobbyContext,
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
  spec.onSuccess({ id: userId, name, created: 0 } as any)

  return run
}

function renderLine(content: React.ReactNode): string {
  const { container } = render(<div>{content}</div>)
  return container.textContent ?? ''
}

/** Builds the error a refused invite hands back, carrying the code the server answered with. */
function fetchErrorWithCode(code: string): FetchError {
  const bodyText = JSON.stringify({ code })
  return new FetchError(new Response(bodyText, { status: 409, statusText: 'Conflict' }), bodyText)
}

describe('messaging/commands/commands/invite-to-lobby', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('/invite invites the named user to the lobby', () => {
    const { result, emit } = runForTarget('/invite tec27')

    expect(result).toEqual({ kind: 'command' })
    expect(inviteToLobby).toHaveBeenCalledWith(TARGET_ID, expect.anything())

    asMockedFunction(inviteToLobby).mock.calls[0][1].onSuccess()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('Invited tec27 to lobby.')
  })

  test('/invite refuses to name the user running it', () => {
    const { emit } = runForTarget('/invite Marko', undefined, SELF_ID)

    expect(inviteToLobby).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0]).toEqual({
      kind: 'error',
      content: "You can't invite yourself to your lobby.",
    })
  })

  test('/invite without a user names nobody and is refused by the parser', () => {
    const { result, emit } = runInput('/invite')

    expect(result).toEqual({ kind: 'command' })
    expect(inviteToLobby).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('Missing <user>')
  })

  test.each([
    [InviteToLobbyErrorCode.AlreadyInvited, 'That user already has an invite to this lobby.'],
    [InviteToLobbyErrorCode.AlreadyInLobby, 'That user is already in this lobby.'],
    [InviteToLobbyErrorCode.BannedFromLobby, 'That user has been banned from this lobby.'],
    [
      InviteToLobbyErrorCode.NotAcceptingInvites,
      "That user isn't accepting lobby invites from you.",
    ],
  ])('a refused invite (%s) says why', (code, message) => {
    const { emit } = runForTarget('/invite tec27')

    asMockedFunction(inviteToLobby).mock.calls[0][1].onError(fetchErrorWithCode(code))

    expect(emit.mock.calls[0][0]).toEqual({ kind: 'error', content: message })
  })

  test('a failure the server did not classify falls back to the generic error', () => {
    const { emit } = runForTarget('/invite tec27')

    asMockedFunction(inviteToLobby).mock.calls[0][1].onError(fetchErrorWithCode('somethingElse'))

    expect(emit.mock.calls[0][0]).toEqual({
      kind: 'error',
      content: 'Error inviting user to lobby',
    })
  })

  test('the palette offers everyone but the people already in the lobby', () => {
    const state = makeState({
      friends: [SEATED_ID, BENCHED_ID, FREE_ID],
      lobbyMembers: [SEATED_ID, BENCHED_ID],
    })

    const suggestions = inviteCommand.args[0].suggest!({
      context: lobbyContext,
      getState: () => state,
    })

    expect(suggestions.map(s => s.value)).toEqual(['Carol'])
  })
})
