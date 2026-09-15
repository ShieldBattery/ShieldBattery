import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { DEFAULT_ACCOUNT_SETTINGS } from '../../../../common/settings/account-settings'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { RootState } from '../../../root-reducer'
import { sendMessage as sendWhisperMessage } from '../../../whispers/action-creators'
import { ChannelCommandContext, CommandContext, WhisperCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { sendWhisperInPlace } from './whisper'

// Only the send the helper reaches for is stubbed; the rest of the module stays real.
vi.mock('../../../whispers/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../whispers/action-creators')>()),
  sendMessage: vi.fn(() => ({ type: 'TEST/whisperSend' })),
}))

// The sent-line is built with `Trans`, which needs an i18next instance to render against.
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
const TARGET = { id: TARGET_ID, name: 'tec27' }

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: SELF_ID,
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

const whisperContextWithTarget: WhisperCommandContext = {
  surface: 'whisper',
  selfUserId: SELF_ID,
  targetId: TARGET_ID,
}

/** A store holding just the account setting the helper reads. */
function makeState(showWhispersEverywhere: boolean): RootState {
  return {
    settings: { account: { ...DEFAULT_ACCOUNT_SETTINGS, showWhispersEverywhere } },
  } as any as RootState
}

function sendInPlace(
  text: string,
  {
    context = channelContext,
    state = makeState(true),
  }: { context?: CommandContext; state?: RootState } = {},
) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn((action: unknown) => {
    if (typeof action === 'function') {
      ;(action as (d: unknown, getState: () => RootState) => void)(dispatch, () => state)
    }
  })
  const failedLine = vi.fn((err: Error) => `failed: ${err.message}`)

  sendWhisperInPlace(TARGET, text, { context, dispatch: dispatch as any, t, emit }, failedLine)

  const spec = asMockedFunction(sendWhisperMessage).mock.calls.at(-1)![2]

  return { emit, dispatch, failedLine, spec }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/commands/whisper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('setting on: a successful send emits nothing', () => {
    const { emit, spec } = sendInPlace('hello', { state: makeState(true) })

    spec.onSuccess(undefined as any)

    expect(emit).not.toHaveBeenCalled()
  })

  test('setting off, a channel or lobby surface: a successful send says it was sent', () => {
    const { emit, spec } = sendInPlace('hello', {
      context: channelContext,
      state: makeState(false),
    })

    spec.onSuccess(undefined as any)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].kind).toBe('info')
    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('Whisper sent to')
    expect(text).toContain('tec27')
  })

  test("setting off, the target's own conversation: nothing is shown", () => {
    const { emit, spec } = sendInPlace('hello', {
      context: whisperContextWithTarget,
      state: makeState(false),
    })

    spec.onSuccess(undefined as any)

    expect(emit).not.toHaveBeenCalled()
  })

  test('a failed send answers with the given line', () => {
    const { emit, failedLine, spec } = sendInPlace('hello')
    const err = new Error('boom')

    spec.onError(err)

    expect(failedLine).toHaveBeenCalledWith(err)
    expect(emit).toHaveBeenCalledWith({ kind: 'error', content: 'failed: boom' })
  })
})
