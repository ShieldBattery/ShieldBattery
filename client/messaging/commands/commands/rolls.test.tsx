import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ChatServiceErrorCode, makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { sendOutcome as sendChannelOutcome } from '../../../chat/action-creators'
import { sendOutcome as sendLobbyOutcome } from '../../../lobbies/action-creators'
import { FetchError } from '../../../network/fetch-errors'
import { sendOutcome as sendWhisperOutcome } from '../../../whispers/action-creators'
import {
  ChannelCommandContext,
  CommandContext,
  LobbyCommandContext,
  WhisperCommandContext,
} from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { eightBallCommand, flipCommand, rollCommand } from './rolls'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the senders the commands reach for are stubbed; the rest of each module stays real.
vi.mock('../../../chat/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../chat/action-creators')>()),
  sendOutcome: vi.fn(() => ({ type: 'TEST/channelOutcome' })),
}))
vi.mock('../../../whispers/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../whispers/action-creators')>()),
  sendOutcome: vi.fn(() => ({ type: 'TEST/whisperOutcome' })),
}))
vi.mock('../../../lobbies/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lobbies/action-creators')>()),
  sendOutcome: vi.fn(() => ({ type: 'TEST/lobbyOutcome' })),
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

const CHANNEL_ID = makeSbChannelId(1)
const SELF_ID = makeSbUserId(1)
const TARGET_ID = makeSbUserId(2)

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: CHANNEL_ID,
  selfUserId: SELF_ID,
  members: [{ id: TARGET_ID, name: 'tec27', online: true }],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

const whisperContext: WhisperCommandContext = {
  surface: 'whisper',
  selfUserId: SELF_ID,
  targetId: TARGET_ID,
}

const lobbyContext: LobbyCommandContext = {
  surface: 'lobby',
  selfUserId: SELF_ID,
}

const ALL_ROLL_COMMANDS = [rollCommand, flipCommand, eightBallCommand]

function runInput(input: string, context: CommandContext = channelContext) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn()
  const result = runChatCommandWith(ALL_ROLL_COMMANDS, input, { context, dispatch, t, emit })

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

const CHAT_RESTRICTED_LINE = "You're currently restricted from sending chat messages."

describe('messaging/commands/commands/rolls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('/roll asks the channel to settle a default roll', () => {
    const { result, dispatch } = runInput('/roll')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelOutcome).toHaveBeenCalledWith(CHANNEL_ID, { kind: 'roll' }, expect.anything())
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/channelOutcome' })
  })

  test('/roll asks the whisper to settle a default roll', () => {
    const { dispatch } = runInput('/roll', whisperContext)

    expect(sendWhisperOutcome).toHaveBeenCalledWith(TARGET_ID, { kind: 'roll' }, expect.anything())
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/whisperOutcome' })
  })

  test('/roll asks the lobby to settle a default roll', () => {
    const { dispatch } = runInput('/roll', lobbyContext)

    expect(sendLobbyOutcome).toHaveBeenCalledWith({ kind: 'roll' }, expect.anything())
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/lobbyOutcome' })
  })

  test('/roll 6 asks for a roll up to 6', () => {
    const { dispatch } = runInput('/roll 6')

    expect(sendChannelOutcome).toHaveBeenCalledWith(
      CHANNEL_ID,
      { kind: 'roll', max: 6 },
      expect.anything(),
    )
    expect(dispatch).toHaveBeenCalled()
  })

  test('/roll 1 is refused: the upper bound must be at least 2', () => {
    const { result, dispatch, emit } = runInput('/roll 1')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelOutcome).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('Invalid <max>')
  })

  test('/roll 1000001 is refused: it is past the upper bound the server accepts', () => {
    const { result, dispatch, emit } = runInput('/roll 1000001')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelOutcome).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('Invalid <max>')
  })

  test('/roll 2.5 is refused: the upper bound has to be an integer', () => {
    const { result, dispatch, emit } = runInput('/roll 2.5')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelOutcome).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('Invalid <max>')
  })

  test('/flip asks the channel to settle a coin flip', () => {
    const { dispatch } = runInput('/flip')

    expect(sendChannelOutcome).toHaveBeenCalledWith(CHANNEL_ID, { kind: 'flip' }, expect.anything())
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/channelOutcome' })
  })

  test('/8ball with no question answers with the usage instead of asking anything', () => {
    const { result, dispatch, emit } = runInput('/8ball')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelOutcome).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('Missing <question>')
    expect(text).toContain('/8ball <question>')
  })

  test('/8ball will I win asks the channel to settle a question', () => {
    const { dispatch } = runInput('/8ball will I win')

    expect(sendChannelOutcome).toHaveBeenCalledWith(
      CHANNEL_ID,
      { kind: 'eightBall', question: 'will I win' },
      expect.anything(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/channelOutcome' })
  })

  test('a chat restriction answers with a line saying so', () => {
    const { emit } = runInput('/roll')
    const spec = asMockedFunction(sendChannelOutcome).mock.calls[0][2]

    spec.onError(fetchErrorWithCode(ChatServiceErrorCode.UserChatRestricted))

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toContain(CHAT_RESTRICTED_LINE)
  })

  test('the differently spelled whisper restriction code answers the same way', () => {
    const { emit } = runInput('/roll', whisperContext)
    const spec = asMockedFunction(sendWhisperOutcome).mock.calls[0][2]

    spec.onError(fetchErrorWithCode(WhisperServiceErrorCode.UserChatRestricted))

    expect(renderLine(emit.mock.calls[0][0].content)).toContain(CHAT_RESTRICTED_LINE)
  })

  test('any other failure answers with the error it carried', () => {
    const { emit } = runInput('/roll', lobbyContext)
    const spec = asMockedFunction(sendLobbyOutcome).mock.calls[0][1]

    spec.onError(new Error('the lobby is gone'))

    expect(renderLine(emit.mock.calls[0][0].content)).toContain(
      "Couldn't settle that: the lobby is gone",
    )
  })
})
