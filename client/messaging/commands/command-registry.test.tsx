import { render, screen } from '@testing-library/react'
import i18next, { TFunction } from 'i18next'
import * as React from 'react'
import { initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../common/chat'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ChannelCommandContext, WhisperCommandContext } from './command-context'
import { ALL_COMMANDS, findCommand } from './command-registry'
import {
  formatAliases,
  getCommandUsage,
  getRunnableCommands,
  getSurfaceCommands,
  groupCommands,
} from './command-schema'
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

function channelContext(
  canKick: boolean,
  canBan: boolean,
  canEditChannel = false,
): ChannelCommandContext {
  return {
    surface: 'channel',
    channelId: makeSbChannelId(1),
    selfUserId,
    members: [
      { id: selfUserId, name: 'Marko', online: true },
      { id: otherUserId, name: 'tec27', online: true },
    ],
    canKick,
    canBan,
    canEditChannel,
  }
}

function whisperContext(): WhisperCommandContext {
  return { surface: 'whisper', selfUserId, targetId: otherUserId }
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
      'reply',
      'profile',
      'stats',
      'rank',
      'whois',
      'who',
      'whoami',
      'f',
      'block',
      'unblock',
      'leave',
      'close',
      'kick',
      'ban',
      'unban',
      'topic',
      'me',
      'cancel',
      'shrug',
      'tableflip',
      'unflip',
      'quote',
      'roll',
      'flip',
      '8ball',
    ])
  })

  test('every command is filed under its group', () => {
    expect(ALL_COMMANDS.map(c => [c.name, c.group])).toEqual([
      ['help', 'chat'],
      ['join', 'chat'],
      ['whisper', 'chat'],
      ['reply', 'chat'],
      ['profile', 'people'],
      ['stats', 'people'],
      ['rank', 'people'],
      ['whois', 'people'],
      ['who', 'chat'],
      ['whoami', 'people'],
      ['f', 'people'],
      ['block', 'people'],
      ['unblock', 'people'],
      ['leave', 'chat'],
      ['close', 'chat'],
      ['kick', 'moderation'],
      ['ban', 'moderation'],
      ['unban', 'moderation'],
      ['topic', 'chat'],
      ['me', 'chat'],
      ['cancel', 'matchmaking'],
      ['shrug', 'fun'],
      ['tableflip', 'fun'],
      ['unflip', 'fun'],
      ['quote', 'fun'],
      ['roll', 'fun'],
      ['flip', 'fun'],
      ['8ball', 'fun'],
    ])
  })

  test('every surface has its own commands', () => {
    expect(getSurfaceCommands(ALL_COMMANDS, 'channel').map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'reply',
      'profile',
      'stats',
      'rank',
      'whois',
      'who',
      'whoami',
      'f',
      'block',
      'unblock',
      'leave',
      'kick',
      'ban',
      'unban',
      'topic',
      'me',
      'cancel',
      'shrug',
      'tableflip',
      'unflip',
      'quote',
      'roll',
      'flip',
      '8ball',
    ])
    expect(getSurfaceCommands(ALL_COMMANDS, 'whisper').map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'reply',
      'profile',
      'stats',
      'rank',
      'whois',
      'who',
      'whoami',
      'f',
      'block',
      'unblock',
      'close',
      'me',
      'cancel',
      'shrug',
      'tableflip',
      'unflip',
      'quote',
      'roll',
      'flip',
      '8ball',
    ])
    expect(getSurfaceCommands(ALL_COMMANDS, 'lobby').map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'reply',
      'profile',
      'stats',
      'rank',
      'whois',
      'who',
      'whoami',
      'f',
      'block',
      'unblock',
      'leave',
      'me',
      'cancel',
      'shrug',
      'tableflip',
      'unflip',
      'quote',
      'roll',
      'flip',
      '8ball',
    ])
  })

  test('moderation is only runnable by those who can moderate', () => {
    const kick = findCommand('kick')!
    const ban = findCommand('ban')!
    const unban = findCommand('unban')!
    const topic = findCommand('topic')!

    expect(kick.getUnavailableReason?.(channelContext(true, true), t)).toBeUndefined()
    expect(ban.getUnavailableReason?.(channelContext(true, true), t)).toBeUndefined()
    expect(unban.getUnavailableReason?.(channelContext(true, true), t)).toBeUndefined()
    expect(topic.getUnavailableReason?.(channelContext(false, false, true), t)).toBeUndefined()
    expect(kick.getUnavailableReason?.(channelContext(false, false), t)).toBe(
      "You don't have permission to kick users from this channel.",
    )
    expect(ban.getUnavailableReason?.(channelContext(false, false), t)).toBe(
      "You don't have permission to ban users from this channel.",
    )
    expect(unban.getUnavailableReason?.(channelContext(true, false), t)).toBe(
      "You don't have permission to unban users from this channel.",
    )
    expect(topic.getUnavailableReason?.(channelContext(true, true), t)).toBe(
      'Only the channel owner and server moderators can change the topic.',
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
    expect(getCommandUsage(findCommand('reply')!)).toBe('/reply [message]')
    expect(getCommandUsage(findCommand('leave')!)).toBe('/leave')
    expect(getCommandUsage(findCommand('kick')!)).toBe('/kick <user> [reason]')
    expect(getCommandUsage(findCommand('profile')!)).toBe('/profile [user]')
    expect(getCommandUsage(findCommand('stats')!)).toBe('/stats [user]')
    expect(getCommandUsage(findCommand('whois')!)).toBe('/whois [user]')
    expect(getCommandUsage(findCommand('who')!)).toBe('/who <channel>')
    expect(getCommandUsage(findCommand('whoami')!)).toBe('/whoami')
    expect(getCommandUsage(findCommand('f')!)).toBe('/f <add|remove|list>')
    expect(getCommandUsage(findCommand('block')!)).toBe('/block <user>')
    expect(getCommandUsage(findCommand('unblock')!)).toBe('/unblock <user>')
    expect(getCommandUsage(findCommand('unban')!)).toBe('/unban <user>')
    expect(getCommandUsage(findCommand('topic')!)).toBe('/topic <text>')
    expect(getCommandUsage(findCommand('cancel')!)).toBe('/cancel')
    expect(formatAliases(findCommand('join')!)).toBe('/j, /channel')
    expect(formatAliases(findCommand('reply')!)).toBe('/r')
    expect(formatAliases(findCommand('whois')!)).toBe('/where, /whereis')
    expect(formatAliases(findCommand('f')!)).toBe('/friends')
    expect(formatAliases(findCommand('block')!)).toBe('/ignore, /squelch')
    expect(formatAliases(findCommand('unblock')!)).toBe('/unignore, /unsquelch')
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
            group: 'chat',
          },
          {
            name: 'join',
            aliases: ['j', 'channel'],
            args: [{ label: 'channel', optional: false }],
            description: 'Joins a chat channel, creating it if it does not exist.',
            group: 'chat',
          },
          {
            name: 'whisper',
            aliases: ['w', 'm', 'msg', 'tell', 't'],
            args: [
              { label: 'user', optional: false },
              { label: 'message', optional: true },
            ],
            description: 'Sends a private message to a user.',
            group: 'chat',
          },
          {
            name: 'reply',
            aliases: ['r'],
            args: [{ label: 'message', optional: true }],
            description: 'Whispers back to the last person who whispered you.',
            group: 'chat',
          },
          {
            name: 'profile',
            aliases: ['p'],
            args: [{ label: 'user', optional: true }],
            description: "Shows a user's profile card: their rank and win/loss record.",
            group: 'people',
          },
          {
            name: 'stats',
            aliases: ['astat'],
            args: [{ label: 'user', optional: true }],
            description: "Shows a user's win/loss record and ranks.",
            group: 'people',
          },
          {
            name: 'rank',
            aliases: ['mmr'],
            args: [{ label: 'user', optional: true }],
            description: "Shows a user's current ranked divisions.",
            group: 'people',
          },
          {
            name: 'whois',
            aliases: ['where', 'whereis'],
            args: [{ label: 'user', optional: true }],
            description: 'Shows what a user is doing, as far as you can see.',
            group: 'people',
          },
          {
            name: 'who',
            aliases: [],
            args: [{ label: 'channel', optional: false }],
            description: 'Lists who is in a channel you have joined.',
            group: 'chat',
          },
          {
            name: 'whoami',
            aliases: [],
            args: [],
            description: 'Shows the name and user ID you are logged in as.',
            group: 'people',
          },
          {
            name: 'f',
            aliases: ['friends'],
            args: [{ label: 'add|remove|list', optional: false }],
            description:
              'Manages your friends list: add, remove, or list them with their current activity.',
            group: 'people',
          },
          {
            name: 'block',
            aliases: ['ignore', 'squelch'],
            args: [{ label: 'user', optional: false }],
            description: 'Blocks a user: hides their messages here and in any game you launch.',
            group: 'people',
          },
          {
            name: 'unblock',
            aliases: ['unignore', 'unsquelch'],
            args: [{ label: 'user', optional: false }],
            description: 'Unblocks a user.',
            group: 'people',
          },
          {
            name: 'leave',
            aliases: [],
            args: [],
            description: 'Leaves the channel or lobby you are in.',
            group: 'chat',
          },
          {
            name: 'me',
            aliases: ['emote'],
            args: [{ label: 'action', optional: false }],
            description: 'Sends an action line, shown as "* YourName does something".',
            group: 'chat',
          },
          {
            name: 'cancel',
            aliases: [],
            args: [],
            description: 'Cancels your current matchmaking search.',
            group: 'matchmaking',
          },
          {
            name: 'shrug',
            aliases: [],
            args: [{ label: 'text', optional: true }],
            description: 'Appends ¯\\_(ツ)_/¯ to your message.',
            group: 'fun',
          },
          {
            name: 'tableflip',
            aliases: [],
            args: [],
            description: 'Flips a table: (╯°□°)╯︵ ┻━┻',
            group: 'fun',
          },
          {
            name: 'unflip',
            aliases: [],
            args: [],
            description: 'Puts the table back: ┬─┬ ノ( ゜-゜ノ)',
            group: 'fun',
          },
          {
            name: 'quote',
            aliases: [],
            args: [{ label: 'unit', optional: true }],
            description: 'Quotes a random Brood War unit line, from one unit if you name it.',
            group: 'fun',
          },
          {
            name: 'roll',
            aliases: [],
            args: [{ label: 'max', optional: true }],
            description:
              'Rolls a number from 1 to {{max}}, or up to the number you give. The server ' +
              "rolls it, so it can't be faked.",
            group: 'fun',
          },
          {
            name: 'flip',
            aliases: [],
            args: [],
            description: 'Flips a coin, settled by the server.',
            group: 'fun',
          },
          {
            name: '8ball',
            aliases: [],
            args: [{ label: 'question', optional: false }],
            description: 'Asks the magic 8-ball a question, answered by the server.',
            group: 'fun',
          },
        ],
      },
    })
  })

  test('/help leaves out the commands that cannot be run here', () => {
    const dispatch = vi.fn()
    const emit = vi.fn()

    runChatCommand('/help', { context: channelContext(false, false), dispatch, t, emit })
    let names = dispatch.mock.calls[0][0].payload.initData.commands.map(
      (c: { name: string }) => c.name,
    )
    expect(names).not.toContain('kick')
    expect(names).not.toContain('ban')

    runChatCommand('/help', { context: channelContext(true, true), dispatch, t, emit })
    names = dispatch.mock.calls[1][0].payload.initData.commands.map((c: { name: string }) => c.name)
    expect(names).toContain('kick')
    expect(names).toContain('ban')
  })

  test('help groups only what can be run here', () => {
    const whisperGroups = groupCommands(getRunnableCommands(ALL_COMMANDS, whisperContext(), t))
    expect(whisperGroups.map(({ group, commands }) => [group, commands.map(c => c.name)])).toEqual([
      ['chat', ['help', 'join', 'whisper', 'reply', 'who', 'close', 'me']],
      ['people', ['profile', 'stats', 'rank', 'whois', 'whoami', 'f', 'block', 'unblock']],
      ['matchmaking', ['cancel']],
      ['fun', ['shrug', 'tableflip', 'unflip', 'quote', 'roll', 'flip', '8ball']],
    ])

    const noModGroups = groupCommands(
      getRunnableCommands(ALL_COMMANDS, channelContext(false, false), t),
    )
    expect(noModGroups.map(({ group }) => group)).not.toContain('moderation')

    const modGroups = groupCommands(
      getRunnableCommands(ALL_COMMANDS, channelContext(true, true), t),
    )
    expect(modGroups.map(({ group }) => group)).toEqual([
      'chat',
      'people',
      'matchmaking',
      'moderation',
      'fun',
    ])
    expect(
      modGroups.find(({ group }) => group === 'moderation')?.commands.map(c => c.name),
    ).toEqual(['kick', 'ban', 'unban'])
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
