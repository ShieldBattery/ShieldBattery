import { TFunction } from 'i18next'
import { describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../common/chat'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ChannelCommandContext } from './command-context'
import { ALL_COMMANDS, findCommand, getAvailableCommands } from './command-registry'
import { formatAliases, getCommandUsage } from './command-schema'
import { runChatCommand } from './run-chat-command'

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

  test('a channel offers moderation only to those who can moderate', () => {
    expect(getAvailableCommands(channelContext(false, false)).map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
    ])
    expect(getAvailableCommands(channelContext(true, false)).map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'kick',
    ])
    expect(getAvailableCommands(channelContext(true, true)).map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'kick',
      'ban',
    ])
  })

  test('a whisper offers closing rather than leaving', () => {
    expect(
      getAvailableCommands({ surface: 'whisper', selfUserId, targetId: otherUserId }).map(
        c => c.name,
      ),
    ).toEqual(['help', 'join', 'whisper', 'close'])
  })

  test('a lobby offers leaving rather than closing', () => {
    expect(getAvailableCommands({ surface: 'lobby', selfUserId }).map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
    ])
  })

  test('names and aliases resolve without regard to case', () => {
    const context = channelContext(true, true)

    expect(findCommand('J', context)?.name).toBe('join')
    expect(findCommand('CHANNEL', context)?.name).toBe('join')
    expect(findCommand('?', context)?.name).toBe('help')
    expect(findCommand('close', context)).toBeUndefined()
  })

  test('usage strings', () => {
    const context = channelContext(true, true)

    expect(getCommandUsage(findCommand('help', context)!)).toBe('/help [command]')
    expect(getCommandUsage(findCommand('join', context)!)).toBe('/join <channel>')
    expect(getCommandUsage(findCommand('whisper', context)!)).toBe('/whisper <user> [message]')
    expect(getCommandUsage(findCommand('leave', context)!)).toBe('/leave')
    expect(getCommandUsage(findCommand('kick', context)!)).toBe('/kick <user> [reason]')
    expect(formatAliases(findCommand('join', context)!)).toBe('/j, /channel')
    expect(formatAliases(findCommand('leave', context)!)).toBe('')
  })

  test('/help opens the dialog listing what is available', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    const result = runChatCommand('/help', {
      context: channelContext(true, true),
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
          },
          {
            name: 'ban',
            aliases: [],
            args: [
              { label: 'user', optional: false },
              { label: 'reason', optional: true },
            ],
            description: 'Bans a user from this channel.',
          },
        ],
      },
    })
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
