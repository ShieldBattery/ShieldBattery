import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { UserAvailability } from '../../../../common/users/availability'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { RequestHandlingSpec } from '../../../network/abortable-thunk'
import { mergeAccountSettings } from '../../../settings/action-creators'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { awayCommand, dndCommand } from './availability'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('../../../settings/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../settings/action-creators')>()),
  mergeAccountSettings: vi.fn(() => ({ type: 'TEST/mergeAccountSettings' })),
}))

// The command layer builds its lines with `Trans`, which needs an i18next instance to render
// against even though every line hands it a `t` of its own.
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

// Answers with whatever default value the caller supplied, which is what the real translations
// hold for English anyway.
const t = ((key: string, options?: string | { defaultValue?: string; [k: string]: unknown }) => {
  if (typeof options === 'string') {
    return options
  }
  const template = options?.defaultValue ?? key
  return template.replace(/{{(\w+)}}/g, (match, name) =>
    options?.[name] !== undefined ? String(options[name]) : match,
  )
}) as unknown as TFunction

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: makeSbUserId(1),
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

function run(text: string, current: UserAvailability) {
  const state = { settings: { account: { availability: current } } }
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(dispatch, () => state)
    }
  })
  const result = runChatCommandWith([awayCommand, dndCommand], text, {
    context: channelContext,
    dispatch,
    t,
    emit,
  })

  return { result, emit }
}

function lastRequest(): { settings: unknown; spec: RequestHandlingSpec } {
  const calls = asMockedFunction(mergeAccountSettings).mock.calls
  const [settings, spec] = calls[calls.length - 1]
  return { settings, spec }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/commands/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  test.each([
    ['/away', UserAvailability.Online, UserAvailability.Away],
    ['/away', UserAvailability.DoNotDisturb, UserAvailability.Away],
    ['/away', UserAvailability.Away, UserAvailability.Online],
    ['/dnd', UserAvailability.Online, UserAvailability.DoNotDisturb],
    ['/dnd', UserAvailability.Away, UserAvailability.DoNotDisturb],
    ['/dnd', UserAvailability.DoNotDisturb, UserAvailability.Online],
  ])('%s while %s sets %s', (text, current, expected) => {
    const { result } = run(text, current)

    expect(result).toEqual({ kind: 'command' })
    expect(mergeAccountSettings).toHaveBeenCalledTimes(1)
    expect(lastRequest().settings).toEqual({ availability: expected })
  })

  test('confirms the new status once the change is saved', () => {
    const { emit } = run('/dnd', UserAvailability.Online)
    expect(emit).not.toHaveBeenCalled()

    lastRequest().spec.onSuccess?.()

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('Your status is now Do not disturb.')
  })

  test('reports a failed save', () => {
    const { emit } = run('/away', UserAvailability.Online)

    lastRequest().spec.onError?.(new Error('Network down'))

    expect(emit).toHaveBeenCalledWith({
      kind: 'error',
      content: "Couldn't change your status: Network down",
    })
  })

  test('takes no arguments', () => {
    const { emit } = run('/away brb', UserAvailability.Online)

    expect(mergeAccountSettings).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')
  })
})
