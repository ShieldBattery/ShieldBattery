import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../common/chat'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ChannelCommandContext, CommandContext, WhisperCommandContext } from './command-context'
import { ChatCommand, defineCommand } from './command-schema'
import { LocalLineContent } from './local-output'
import { runChatCommandWith } from './run-chat-command'

vi.mock('../../logging/logger', () => ({
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

const channelContext: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: makeSbUserId(1),
  members: [{ id: makeSbUserId(2), name: 'tec27' }],
  canKick: true,
  canBan: true,
}

const whisperContext: WhisperCommandContext = {
  surface: 'whisper',
  selfUserId: makeSbUserId(1),
  targetId: makeSbUserId(2),
}

const joinRun = vi.fn()
const kickRun = vi.fn()
const hiddenRun = vi.fn()
const listsRun = vi.fn()

const testCommands: ReadonlyArray<ChatCommand> = [
  defineCommand({
    name: 'join',
    aliases: ['j', 'channel'],
    description: () => 'Joins a channel.',
    surfaces: ['channel', 'whisper', 'lobby'],
    args: [{ kind: 'channel', name: 'channel' }],
    run: joinRun,
  }),
  defineCommand({
    name: 'kick',
    description: () => 'Kicks a user.',
    surfaces: ['channel'],
    args: [{ kind: 'user', name: 'user' }],
    run: kickRun,
  }),
  defineCommand({
    name: 'hidden',
    description: () => 'Never available anywhere.',
    surfaces: ['channel'],
    isAvailable: () => false,
    args: [],
    run: hiddenRun,
  }),
  defineCommand({
    name: 'boom',
    description: () => 'Falls over.',
    surfaces: ['channel'],
    args: [],
    run: () => {
      throw new Error('boom')
    },
  }),
  defineCommand({
    name: 'lists',
    description: () => 'Reports what else is available.',
    surfaces: ['channel'],
    args: [],
    run: listsRun,
  }),
]

function runInput(input: string, context: CommandContext = channelContext) {
  const emit = vi.fn<(line: LocalLineContent) => void>()
  const dispatch = vi.fn()
  const result = runChatCommandWith(testCommands, input, { context, dispatch, t, emit })

  return { result, emit, dispatch }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/run-chat-command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('ordinary text is passed back untouched and says nothing', () => {
    const { result, emit, dispatch } = runInput('hello there')

    expect(result).toEqual({ kind: 'text', text: 'hello there' })
    expect(emit).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('a doubled slash is text with one slash, not a command', () => {
    const { result, emit } = runInput('//join ShieldBattery')

    expect(result).toEqual({ kind: 'text', text: '/join ShieldBattery' })
    expect(joinRun).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  test('a command runs and nothing is sent as text', () => {
    const { result, emit } = runInput('/join ShieldBattery')

    expect(result).toEqual({ kind: 'command' })
    expect(joinRun).toHaveBeenCalledTimes(1)
    expect(joinRun.mock.calls[0][0].args).toEqual({ channel: 'ShieldBattery' })
    expect(emit).not.toHaveBeenCalled()
  })

  test('aliases resolve without regard to case', () => {
    runInput('/CHANNEL ShieldBattery')
    runInput('/J ShieldBattery')

    expect(joinRun).toHaveBeenCalledTimes(2)
  })

  test('an unknown name answers with an error line', () => {
    const { result, emit } = runInput('/nope')

    expect(result).toEqual({ kind: 'command' })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].kind).toBe('error')

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('Unknown command')
    expect(text).toContain('/nope')
    expect(text).toContain('/help')
  })

  test('a bare slash answers with an error line naming it', () => {
    const { result, emit } = runInput('/')

    expect(result).toEqual({ kind: 'command' })
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('Unknown command /.')
  })

  test('a missing argument answers with the usage', () => {
    const { result, emit } = runInput('/join')

    expect(result).toEqual({ kind: 'command' })
    expect(joinRun).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('error')

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('Missing <channel>')
    expect(text).toContain('/join <channel>')
  })

  test('an argument that cannot be read answers with the usage', () => {
    const { emit } = runInput('/kick this-name-is-far-too-long-to-be-a-user')

    expect(kickRun).not.toHaveBeenCalled()

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('Invalid <user>')
    expect(text).toContain('this-name-is-far-too-long-to-be-a-user')
    expect(text).toContain('/kick <user>')
  })

  test('a command outside its surfaces is simply unknown', () => {
    const { result, emit } = runInput('/kick tec27', whisperContext)

    expect(result).toEqual({ kind: 'command' })
    expect(kickRun).not.toHaveBeenCalled()
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('Unknown command')
  })

  test('a command whose availability says no is simply unknown', () => {
    const { result, emit } = runInput('/hidden')

    expect(result).toEqual({ kind: 'command' })
    expect(hiddenRun).not.toHaveBeenCalled()
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('Unknown command')
  })

  test('a command is only handed the commands available where it ran', () => {
    runInput('/lists')

    expect(listsRun).toHaveBeenCalledTimes(1)
    expect(listsRun.mock.calls[0][0].availableCommands.map((c: ChatCommand) => c.name)).toEqual([
      'join',
      'kick',
      'boom',
      'lists',
    ])
  })

  test('a command that falls over answers with an error line', () => {
    const { result, emit } = runInput('/boom')

    expect(result).toEqual({ kind: 'command' })
    expect(emit.mock.calls[0][0].kind).toBe('error')
    expect(renderLine(emit.mock.calls[0][0].content)).toContain('/boom')
  })
})
