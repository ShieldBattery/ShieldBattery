import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../common/chat'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ChannelCommandContext } from './command-context'
import { ALL_COMMANDS, findCommand } from './command-registry'
import { formatAliases, getCommandUsage, getSurfaceCommands } from './command-schema'
import { runChatCommand } from './run-chat-command'

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

const selfUserId = makeSbUserId(1)
const otherUserId = makeSbUserId(2)

function channelContext(canKick: boolean, canBan: boolean): ChannelCommandContext {
  return {
    surface: 'channel',
    channelId: makeSbChannelId(1),
    selfUserId,
    members: [
      { id: selfUserId, name: 'Marko' },
      { id: otherUserId, name: 'tec27' },
    ],
    canKick,
    canBan,
  }
}

function renderLine(content: React.ReactNode): string {
  render(<div data-testid='line'>{content}</div>)
  return screen.getByTestId('line').textContent ?? ''
}

describe('messaging/commands/command-registry', () => {
  test('the commands are listed in the order help shows them', () => {
    expect(ALL_COMMANDS.map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'close',
      'kick',
      'ban',
    ])
  })

  test('every surface has its own commands', () => {
    expect(getSurfaceCommands(ALL_COMMANDS, 'channel').map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'kick',
      'ban',
    ])
    expect(getSurfaceCommands(ALL_COMMANDS, 'whisper').map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'close',
    ])
    expect(getSurfaceCommands(ALL_COMMANDS, 'lobby').map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
    ])
  })

  test('moderation is only runnable by those who can moderate', () => {
    const kick = findCommand('kick')!
    const ban = findCommand('ban')!

    expect(kick.getUnavailableReason?.(channelContext(true, true), t)).toBeUndefined()
    expect(ban.getUnavailableReason?.(channelContext(true, true), t)).toBeUndefined()
    expect(kick.getUnavailableReason?.(channelContext(false, false), t)).toBe(
      "You don't have permission to kick users from this channel.",
    )
    expect(ban.getUnavailableReason?.(channelContext(false, false), t)).toBe(
      "You don't have permission to ban users from this channel.",
    )
  })

  test('names and aliases resolve without regard to case', () => {
    expect(findCommand('J')?.name).toBe('join')
    expect(findCommand('CHANNEL')?.name).toBe('join')
    expect(findCommand('?')?.name).toBe('help')
    // A name resolves to the command it belongs to wherever that command lives, so that naming one
    // from somewhere it can't run is answerable.
    expect(findCommand('close')?.name).toBe('close')
    expect(findCommand('nope')).toBeUndefined()
  })

  test('usage strings', () => {
    expect(getCommandUsage(findCommand('help')!)).toBe('/help [command]')
    expect(getCommandUsage(findCommand('join')!)).toBe('/join <channel>')
    expect(getCommandUsage(findCommand('whisper')!)).toBe('/whisper <user> [message]')
    expect(getCommandUsage(findCommand('leave')!)).toBe('/leave')
    expect(getCommandUsage(findCommand('kick')!)).toBe('/kick <user> [reason]')
    expect(formatAliases(findCommand('join')!)).toBe('/j, /channel')
    expect(formatAliases(findCommand('leave')!)).toBe('')
  })

  test('/help opens the dialog listing everything the surface has', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    const result = runChatCommand('/help', {
      context: channelContext(false, false),
      dispatch,
      t,
      emit,
    })

    expect(result).toEqual({ kind: 'command' })
    expect(emit).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0].payload).toEqual({
      type: 'chatCommandHelp',
      initData: {
        commands: [
          {
            name: 'help',
            aliases: ['?'],
            args: [{ label: 'command', optional: true }],
            description: 'Lists the commands you can use here.',
          },
          {
            name: 'join',
            aliases: ['j', 'channel'],
            args: [{ label: 'channel', optional: false }],
            description: 'Joins a chat channel, creating it if it does not exist.',
          },
          {
            name: 'whisper',
            aliases: ['w', 'm', 'msg', 'tell', 't'],
            args: [
              { label: 'user', optional: false },
              { label: 'message', optional: true },
            ],
            description: 'Sends a private message to a user.',
          },
          {
            name: 'leave',
            aliases: [],
            args: [],
            description: 'Leaves the channel or lobby you are in.',
          },
          {
            name: 'kick',
            aliases: [],
            args: [
              { label: 'user', optional: false },
              { label: 'reason', optional: true },
            ],
            description: 'Kicks a user out of this channel.',
            unavailableReason: "You don't have permission to kick users from this channel.",
          },
          {
            name: 'ban',
            aliases: [],
            args: [
              { label: 'user', optional: false },
              { label: 'reason', optional: true },
            ],
            description: 'Bans a user from this channel.',
            unavailableReason: "You don't have permission to ban users from this channel.",
          },
        ],
      },
    })
  })

  test('/help gives no reason for a command that can be run', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    runChatCommand('/help', { context: channelContext(true, true), dispatch, t, emit })

    for (const command of dispatch.mock.calls[0][0].payload.initData.commands) {
      expect(command.unavailableReason).toBeUndefined()
    }
  })

  test('/help names a command that only works somewhere else', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    runChatCommand('/help close', { context: channelContext(true, true), dispatch, t, emit })

    expect(dispatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].kind).toBe('info')

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('/close — Closes this whisper conversation.')
    expect(text).toContain('/close can only be used in whispers.')
  })

  test('/help names a command the user cannot run here', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    runChatCommand('/help kick', { context: channelContext(false, false), dispatch, t, emit })

    expect(dispatch).not.toHaveBeenCalled()

    const text = renderLine(emit.mock.calls[0][0].content)
    expect(text).toContain('/kick <user> [reason] — Kicks a user out of this channel.')
    expect(text).toContain("You don't have permission to kick users from this channel.")
  })

  test('/ban opens the ban dialog with the typed reason', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    runChatCommand('/ban TEC27 being mean', {
      context: channelContext(true, true),
      dispatch,
      t,
      emit,
    })

    expect(emit).not.toHaveBeenCalled()
    expect(dispatch.mock.calls[0][0].payload).toEqual({
      type: 'channelBanUser',
      initData: { channelId: makeSbChannelId(1), userId: otherUserId, banReason: 'being mean' },
    })
  })

  test('a moderation command names nobody in the channel', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    runChatCommand('/kick nobody', { context: channelContext(true, true), dispatch, t, emit })

    expect(dispatch).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].kind).toBe('error')
  })

  test('a moderation command naming the user running it', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    runChatCommand('/kick Marko', { context: channelContext(true, true), dispatch, t, emit })

    expect(dispatch).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].content).toBe("You can't kick yourself.")
  })
})
