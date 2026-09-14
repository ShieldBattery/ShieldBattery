import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { asMockedFunction } from '../../../../common/testing/mocks'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { UserErrorCode } from '../../../../common/users/user-network'
import { FetchError } from '../../../network/fetch-errors'
import { findUserByName } from '../../../users/action-creators'
import { UserCard } from '../../../users/user-card'
import { ChannelCommandContext } from '../command-context'
import { matchesCommandName } from '../command-schema'
import { LocalLineContent } from '../local-output'
import { runChatCommandWith } from '../run-chat-command'
import { profileCommand, rankCommand, statsCommand } from './user-card'

vi.mock('../../../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// Only the lookup the commands reach for is stubbed; the rest of the module stays real, since the
// command registry these run against pulls in every command's action creators.
vi.mock('../../../users/action-creators', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../users/action-creators')>()),
  findUserByName: vi.fn(() => ({ type: 'TEST/findUserByName' })),
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

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: SELF_ID,
  members: [{ id: TARGET_ID, name: 'tec27', online: true }],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

const state = {
  users: { byId: new Map([[SELF_ID, { id: SELF_ID, name: 'Marko', created: 0 }]]) },
} as any

function runInput(input: string) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch: any = vi.fn((action: any) => {
    if (typeof action === 'function') {
      action(dispatch, () => state)
    }
  })
  const result = runChatCommandWith([profileCommand, statsCommand, rankCommand], input, {
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

/** Builds the error a failed lookup hands back, carrying the code the server answered with. */
function fetchErrorWithCode(code: string): FetchError {
  const bodyText = JSON.stringify({ code })
  return new FetchError(new Response(bodyText, { status: 404, statusText: 'Not Found' }), bodyText)
}

describe('messaging/commands/commands/user-card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('naming nobody shows the card of whoever ran it', () => {
    const { result, emit } = runInput('/profile')

    expect(result).toEqual({ kind: 'command' })
    expect(findUserByName).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledTimes(1)

    const line = emit.mock.calls[0][0]
    expect(line.kind).toBe('card')
    expect((line.content as React.ReactElement).type).toBe(UserCard)
    expect((line.content as React.ReactElement<{ userId: number }>).props.userId).toBe(SELF_ID)
  })

  test('a named user is looked up and shown once they resolve', () => {
    const { emit } = runInput('/profile tec27')

    expect(emit).not.toHaveBeenCalled()
    expect(findUserByName).toHaveBeenCalledWith('tec27', expect.anything())

    const spec = asMockedFunction(findUserByName).mock.calls[0][1]
    spec.onSuccess({ id: TARGET_ID, name: 'tec27', created: 0 })

    const line = emit.mock.calls[0][0]
    expect(line.kind).toBe('card')
    expect((line.content as React.ReactElement<{ userId: number }>).props.userId).toBe(TARGET_ID)
  })

  test('a name nobody goes by answers with an error line', () => {
    const { emit } = runInput('/profile nobody')

    const spec = asMockedFunction(findUserByName).mock.calls[0][1]
    spec.onError(fetchErrorWithCode(UserErrorCode.NotFound))

    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('No user named nobody.')
  })

  test('a lookup that failed some other way answers with the error it carried', () => {
    const { emit } = runInput('/profile tec27')

    const spec = asMockedFunction(findUserByName).mock.calls[0][1]
    spec.onError(new Error('the server is on fire'))

    expect(renderLine(emit.mock.calls[0][0].content)).toContain(
      "Couldn't look up tec27: the server is on fire",
    )
  })

  test('/stats takes nothing past the user', () => {
    const { emit } = runInput('/stats tec27 extra')

    expect(findUserByName).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('Too many arguments')
    expect(text).toContain('/stats [user]')
  })

  test('the aliases reach the commands they belong to', () => {
    expect(matchesCommandName(profileCommand, 'p')).toBe(true)
    expect(matchesCommandName(statsCommand, 'astat')).toBe(true)
    expect(matchesCommandName(rankCommand, 'mmr')).toBe(true)

    for (const input of ['/p', '/astat', '/mmr']) {
      const { emit } = runInput(input)
      expect(emit.mock.calls[0][0].kind).toBe('card')
    }
  })
})
