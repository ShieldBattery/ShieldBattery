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
import { quoteCommand } from './quote'
import { QUOTE_CATALOGUE, QUOTE_UNIT_NAMES } from './quote-catalogue'

// Every call picks the first item, which is what makes the "sends the first unit/line" tests
// deterministic without caring about the real randomness the command uses in production.
vi.mock('../../../../common/random', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../common/random')>()),
  randomItem: vi.fn((items: ReadonlyArray<unknown>) => items[0]),
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

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: makeSbUserId(1),
  members: [],
  canKick: false,
  canBan: false,
  canEditChannel: false,
}

function runInput(input: string) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn()
  const result = runChatCommandWith([quoteCommand], input, {
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

describe('messaging/commands/commands/quote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('/quote sends the first units first line', () => {
    const { result, dispatch, emit } = runInput('/quote')

    expect(result).toEqual({ kind: 'text', text: QUOTE_CATALOGUE[0].lines[0](t) })
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  test('/quote marine sends the marines first line', () => {
    const marine = QUOTE_CATALOGUE.find(unit => unit.name === 'marine')!
    const { result, dispatch } = runInput('/quote marine')

    expect(result).toEqual({ kind: 'text', text: marine.lines[0](t) })
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('the unit name is matched without regard to case', () => {
    const marine = QUOTE_CATALOGUE.find(unit => unit.name === 'marine')!
    const { result } = runInput('/quote MARINE')

    expect(result).toEqual({ kind: 'text', text: marine.lines[0](t) })
  })

  test('an unknown unit answers with the units there are and sends nothing', () => {
    const { result, dispatch, emit } = runInput('/quote zergling')

    expect(result).toEqual({ kind: 'command' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('No unit named zergling')
    expect(text).toContain('marine, firebat')
  })

  test('the palette is offered every unit there is', () => {
    const suggestions = quoteCommand.args[0].suggest!({
      context: channelContext,
      getState: () => {
        throw new Error('not needed')
      },
    })

    expect(suggestions.map(s => s.value)).toEqual([...QUOTE_UNIT_NAMES])
  })

  test('every catalogue line key is unique and every unit name is lower-case and single-token', () => {
    const seenKeys = new Set<string>()
    const keyCapturingT = ((key: string) => key) as unknown as TFunction

    for (const unit of QUOTE_CATALOGUE) {
      expect(unit.name).toMatch(/^[a-z]+$/)

      for (const line of unit.lines) {
        const key = line(keyCapturingT)
        expect(seenKeys.has(key)).toBe(false)
        seenKeys.add(key)
      }
    }
  })
})
