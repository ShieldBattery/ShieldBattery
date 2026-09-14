import { render } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ChatServiceErrorCode, makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'
import { unbanUser } from '../../../chat/action-creators'
import { FetchError } from '../../../network/fetch-errors'
import { findUserByName } from '../../../users/action-creators'
import { ChannelCommandContext, CommandContext, WhisperCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { unbanCommand } from './unban'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the requests the command reaches for are stubbed; the rest of each module stays real, since
// the command registry these run against pulls in every command's action creators.
vi.mock('../../../users/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../users/action-creators')>()),
  findUserByName: vi.fn(() => ({ type: 'TEST/findUserByName' })),
}))

vi.mock('../../../chat/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../chat/action-creators')>()),
  unbanUser: vi.fn(() => ({ type: 'TEST/unbanUser' })),
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
const CHANNEL_ID = makeSbChannelId(1)

userNames.set(SELF_ID, 'Marko')
userNames.set(TARGET_ID, 'tec27')

function channelContext(canBan: boolean): ChannelCommandContext {
  return {
    surface: 'channel',
    channelId: CHANNEL_ID,
    selfUserId: SELF_ID,
    members: [],
    canKick: false,
    canBan,
    canEditChannel: false,
  }
}

const whisperContext: WhisperCommandContext = {
  surface: 'whisper',
  selfUserId: SELF_ID,
  targetId: TARGET_ID,
}

const state = {
  users: { byId: new Map([[SELF_ID, { id: SELF_ID, name: 'Marko', created: 0 }]]) },
} as any

function runInput(input: string, context: CommandContext = channelContext(true)) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(dispatch, () => state)
    }
  })
  const result = runChatCommandWith([unbanCommand], input, { context, dispatch, t, emit })

  return { result, emit, dispatch }
}

/** Runs the command for a named user and resolves the lookup to `TARGET_ID`, as the server would. */
function runForTarget(input: string, context: CommandContext = channelContext(true)) {
  const run = runInput(input, context)

  expect(findUserByName).toHaveBeenCalledTimes(1)
  const [name, spec] = asMockedFunction(findUserByName).mock.calls[0]
  spec.onSuccess({ id: TARGET_ID, name, created: 0 })

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

describe('messaging/commands/commands/unban', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('lifting a ban says so', () => {
    const { result, emit } = runForTarget('/unban tec27')

    expect(result).toEqual({ kind: 'command' })
    expect(unbanUser).toHaveBeenCalledWith(CHANNEL_ID, TARGET_ID, expect.anything())

    asMockedFunction(unbanUser).mock.calls[0][2].onSuccess()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe(
      'tec27 is no longer banned from this channel.',
    )
  })

  test('a user who was never banned is said to be', () => {
    const { emit } = runForTarget('/unban tec27')

    asMockedFunction(unbanUser).mock.calls[0][2].onError(
      fetchErrorWithCode(ChatServiceErrorCode.TargetNotBanned),
    )

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe("tec27 isn't banned from this channel.")
  })

  test('without permission to ban, the command says why it cannot run', () => {
    const { emit } = runInput('/unban tec27', channelContext(false))

    expect(findUserByName).not.toHaveBeenCalled()
    expect(unbanUser).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(emit.mock.calls[0][0].content).toBe(
      "You don't have permission to unban users from this channel.",
    )
  })

  test('outside a channel the command says where it works', () => {
    const { emit } = runInput('/unban tec27', whisperContext)

    expect(unbanUser).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('/unban can only be used in channels.')
  })

  test('the ban list is not the member list, so nothing is offered for the user', () => {
    const suggest = (unbanCommand.args[0] as { suggest?: (deps: any) => SbUserId[] }).suggest

    expect(suggest?.({ context: channelContext(true), getState: () => state })).toEqual([])
  })
})
