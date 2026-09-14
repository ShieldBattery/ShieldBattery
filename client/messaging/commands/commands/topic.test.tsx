import { render } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ChatServiceErrorCode, makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { updateChannel } from '../../../chat/action-creators'
import { FetchError } from '../../../network/fetch-errors'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { topicCommand } from './topic'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the request the command reaches for is stubbed; the rest of the module stays real, since the
// command registry these run against pulls in every command's action creators.
vi.mock('../../../chat/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../chat/action-creators')>()),
  updateChannel: vi.fn(() => ({ type: 'TEST/updateChannel' })),
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

// Answers with whatever default value the caller supplied, with the values it was handed filled
// into it, which is what the real translations hold for English anyway.
const t = ((key: string, options?: string | { defaultValue?: string; [name: string]: unknown }) => {
  if (typeof options === 'string') {
    return options
  }

  // Only the values handed in are filled in: a `Trans` line's placeholders stand for its own
  // children and are substituted after this hands the string back, so they have to survive it.
  const text = options?.defaultValue ?? key
  return text.replace(/{{(\w+)}}/g, (placeholder, name: string) =>
    options?.[name] !== undefined ? String(options[name]) : placeholder,
  )
}) as unknown as TFunction

const SELF_ID = makeSbUserId(1)
const CHANNEL_ID = makeSbChannelId(1)

function channelContext(canEditChannel: boolean): ChannelCommandContext {
  return {
    surface: 'channel',
    channelId: CHANNEL_ID,
    selfUserId: SELF_ID,
    members: [],
    canKick: false,
    canBan: false,
    canEditChannel,
  }
}

function runInput(input: string, context = channelContext(true)) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn()
  const result = runChatCommandWith([topicCommand], input, { context, dispatch, t, emit })

  return { result, emit, dispatch }
}

function renderLine(content: React.ReactNode): string {
  const { container } = render(<div>{content}</div>)
  return container.textContent ?? ''
}

/** Builds the error a refused request hands back, carrying the code the server answered with. */
function fetchErrorWithCode(code: string): FetchError {
  const bodyText = JSON.stringify({ code })
  return new FetchError(new Response(bodyText, { status: 403, statusText: 'Forbidden' }), bodyText)
}

describe('messaging/commands/commands/topic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('setting the topic says what it was set to', () => {
    const { result, emit } = runInput('/topic  gg no re  ')

    expect(result).toEqual({ kind: 'command' })
    expect(updateChannel).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL_ID, channelChanges: { topic: 'gg no re' } }),
    )

    asMockedFunction(updateChannel).mock.calls[0][0].spec.onSuccess()
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('Topic set to: gg no re')
  })

  test('a topic the server refuses to take says who can set it', () => {
    const { emit } = runInput('/topic gg no re')

    asMockedFunction(updateChannel).mock.calls[0][0].spec.onError(
      fetchErrorWithCode(ChatServiceErrorCode.CannotEditChannel),
    )

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(emit.mock.calls[0][0].content).toBe(
      'Only the channel owner and server moderators can change the topic.',
    )
  })

  test('a topic that failed some other way carries the error it came with', () => {
    const { emit } = runInput('/topic gg no re')

    asMockedFunction(updateChannel).mock.calls[0][0].spec.onError(
      new Error('the server is on fire'),
    )

    expect(emit.mock.calls[0][0].content).toBe("Couldn't set the topic: the server is on fire")
  })

  test('without permission to edit the channel, the command says why it cannot run', () => {
    const { emit } = runInput('/topic gg no re', channelContext(false))

    expect(updateChannel).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(emit.mock.calls[0][0].content).toBe(
      'Only the channel owner and server moderators can change the topic.',
    )
  })

  test('a topic has to be typed', () => {
    const { emit } = runInput('/topic')

    expect(updateChannel).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('Missing <text>. Usage: /topic <text>')
  })
})
