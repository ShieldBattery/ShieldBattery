import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ChatServiceErrorCode, makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { sendMessage as sendChannelMessage } from '../../../chat/action-creators'
import { sendChat as sendLobbyChat } from '../../../lobbies/action-creators'
import { FetchError } from '../../../network/fetch-errors'
import { sendMessage as sendWhisperMessage } from '../../../whispers/action-creators'
import {
  ChannelCommandContext,
  CommandContext,
  LobbyCommandContext,
  WhisperCommandContext,
} from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { meCommand } from './me'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the senders the command reaches for are stubbed; the rest of each module stays real, since
// the command registry these run against pulls in every command's action creators.
vi.mock('../../../chat/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../chat/action-creators')>()),
  sendMessage: vi.fn(() => ({ type: 'TEST/channelSend' })),
}))
vi.mock('../../../whispers/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../whispers/action-creators')>()),
  sendMessage: vi.fn(() => ({ type: 'TEST/whisperSend' })),
}))
vi.mock('../../../lobbies/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lobbies/action-creators')>()),
  sendChat: vi.fn(() => ({ type: 'TEST/lobbySend' })),
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

function runInput(input: string, context: CommandContext = channelContext) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn()
  const result = runChatCommandWith([meCommand], input, { context, dispatch, t, emit })

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

describe('messaging/commands/commands/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('sends the action as a channel message flagged as an emote', () => {
    const { result, dispatch } = runInput('/me waves')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelMessage).toHaveBeenCalledWith(CHANNEL_ID, 'waves', expect.anything(), {
      emote: true,
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/channelSend' })
  })

  test('sends the action as a whisper flagged as an emote', () => {
    const { dispatch } = runInput('/me waves', whisperContext)

    expect(sendWhisperMessage).toHaveBeenCalledWith(TARGET_ID, 'waves', expect.anything(), {
      emote: true,
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/whisperSend' })
  })

  test('sends the action as lobby chat flagged as an emote', () => {
    const { dispatch } = runInput('/me waves', lobbyContext)

    expect(sendLobbyChat).toHaveBeenCalledWith('waves', expect.anything(), { emote: true })
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/lobbySend' })
  })

  test('the emote alias reaches the same command', () => {
    runInput('/emote waves at everyone')

    expect(sendChannelMessage).toHaveBeenCalledWith(
      CHANNEL_ID,
      'waves at everyone',
      expect.anything(),
      { emote: true },
    )
  })

  test('an action with no text sends nothing and answers with the usage', () => {
    const { emit, dispatch } = runInput('/me')

    expect(sendChannelMessage).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('Missing <action>')
    expect(text).toContain('/me <action>')
  })

  test('a chat restriction answers with a line saying so', () => {
    const { emit } = runInput('/me waves')
    const spec = asMockedFunction(sendChannelMessage).mock.calls[0][2]

    spec.onError(fetchErrorWithCode(ChatServiceErrorCode.UserChatRestricted))

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toContain(CHAT_RESTRICTED_LINE)
  })

  test('the differently spelled whisper restriction code answers the same way', () => {
    const { emit } = runInput('/me waves', whisperContext)
    const spec = asMockedFunction(sendWhisperMessage).mock.calls[0][2]

    spec.onError(fetchErrorWithCode(WhisperServiceErrorCode.UserChatRestricted))

    expect(renderLine(emit.mock.calls[0][0].content)).toContain(CHAT_RESTRICTED_LINE)
  })

  test('any other failure answers with the error it carried', () => {
    const { emit } = runInput('/me waves', lobbyContext)
    const spec = asMockedFunction(sendLobbyChat).mock.calls[0][1]

    spec.onError(new Error('the lobby is gone'))

    expect(renderLine(emit.mock.calls[0][0].content)).toContain(
      "Couldn't send your emote: the lobby is gone",
    )
  })
})
