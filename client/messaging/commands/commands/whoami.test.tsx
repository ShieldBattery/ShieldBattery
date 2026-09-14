import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { ChannelCommandContext } from '../command-context'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { whoamiCommand } from './whoami'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
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

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: SELF_ID,
  members: [],
  canKick: false,
  canBan: false,
}

function runWhoami(state: unknown) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(dispatch, () => state)
    }
  })
  const result = runChatCommandWith([whoamiCommand], '/whoami', {
    context: channelContext,
    dispatch,
    t,
    emit,
  })

  return { result, emit, dispatch }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/commands/whoami', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('names the account the command was run from', () => {
    const { result, emit } = runWhoami({
      auth: { self: { user: { id: SELF_ID, name: 'Marko' } } },
      users: { byId: new Map() },
    } as any)

    expect(result).toEqual({ kind: 'command' })
    expect(emit.mock.calls[0][0].kind).toBe('info')
    expect(renderLine(emit.mock.calls[0][0].content)).toBe('You are Marko (user ID 1).')
  })

  test('falls back to the stored user when there is no session to read', () => {
    const { emit } = runWhoami({
      auth: {},
      users: { byId: new Map([[SELF_ID, { id: SELF_ID, name: 'Marko', created: 0 }]]) },
    } as any)

    expect(renderLine(emit.mock.calls[0][0].content)).toBe('You are Marko (user ID 1).')
  })
})
