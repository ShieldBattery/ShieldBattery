import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { QUOTE_UNITS } from '../../../../common/unit-quotes'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { sendOutcome as sendChannelOutcome } from '../../../chat/action-creators'
import { sendOutcome as sendLobbyOutcome } from '../../../lobbies/action-creators'
import { sendOutcome as sendWhisperOutcome } from '../../../whispers/action-creators'
import {
  ChannelCommandContext,
  CommandContext,
  LobbyCommandContext,
  WhisperCommandContext,
} from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { quoteCommand } from './quote'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the senders the command reaches for are stubbed; the rest of each module stays real.
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

// The command's error line is built with `Trans`, which needs an i18next instance to render
// against even though the line hands it a `t` of its own.
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
  members: [],
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

function runInput(input: string, context: CommandContext = channelContext) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn()
  const result = runChatCommandWith([quoteCommand], input, { context, dispatch, t, emit })

  return { result, emit, dispatch }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/commands/quote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('/quote leaves the unit to the server', () => {
    const { result, dispatch, emit } = runInput('/quote')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelOutcome).toHaveBeenCalledWith(
      CHANNEL_ID,
      { kind: 'quote' },
      expect.anything(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/channelOutcome' })
    expect(emit).not.toHaveBeenCalled()
  })

  test('/quote marine asks for that unit', () => {
    const { dispatch } = runInput('/quote marine')

    expect(sendChannelOutcome).toHaveBeenCalledWith(
      CHANNEL_ID,
      { kind: 'quote', unit: 'marine' },
      expect.anything(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/channelOutcome' })
  })

  test('the unit name is matched without regard to case', () => {
    runInput('/quote MARINE')

    expect(sendChannelOutcome).toHaveBeenCalledWith(
      CHANNEL_ID,
      { kind: 'quote', unit: 'marine' },
      expect.anything(),
    )
  })

  test('an unknown unit answers with the units there are and asks for nothing', () => {
    const { result, dispatch, emit } = runInput('/quote zergling')

    expect(result).toEqual({ kind: 'command' })
    expect(sendChannelOutcome).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('No unit named zergling')
    expect(text).toContain('marine, firebat')
  })

  test('a whisper asks the whisper endpoint', () => {
    const { dispatch } = runInput('/quote', whisperContext)

    expect(sendWhisperOutcome).toHaveBeenCalledWith(TARGET_ID, { kind: 'quote' }, expect.anything())
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/whisperOutcome' })
  })

  test('a lobby asks the lobby endpoint', () => {
    const { dispatch } = runInput('/quote firebat', lobbyContext)

    expect(sendLobbyOutcome).toHaveBeenCalledWith(
      { kind: 'quote', unit: 'firebat' },
      expect.anything(),
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'TEST/lobbyOutcome' })
  })

  test('the palette is offered every unit there is', () => {
    const suggestions = quoteCommand.args[0].suggest!({
      context: channelContext,
      getState: () => {
        throw new Error('not needed')
      },
    })

    expect(suggestions.map(s => s.value)).toEqual([...QUOTE_UNITS])
  })
})
