import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { makeSbChannelId } from '../../../common/chat'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { RootState } from '../../root-reducer'
import {
  ChannelCommandContext,
  LobbyCommandContext,
  WhisperCommandContext,
} from './command-context'
import { ALL_COMMANDS } from './command-registry'
import { ArgSuggestDeps, CommandArg, getRunnableCommands } from './command-schema'
import {
  filterArgSuggestions,
  getArgSuggestions,
  matchCommands,
  rankByQuery,
} from './command-suggestions'
import { whisperCommand } from './commands/whisper'

// Answers with whatever default value the caller supplied, which is what the real translations
// hold for English anyway.
const t = ((key: string, options?: string | { defaultValue?: string }) =>
  typeof options === 'string' ? options : (options?.defaultValue ?? key)) as unknown as TFunction

const selfUserId = makeSbUserId(1)
const tec27Id = makeSbUserId(2)
const offlineUserId = makeSbUserId(3)

function channelContext(canModerate = false): ChannelCommandContext {
  return {
    surface: 'channel',
    channelId: makeSbChannelId(1),
    selfUserId,
    members: [
      { id: selfUserId, name: 'Marko', online: true },
      { id: tec27Id, name: 'tec27', online: true },
      { id: offlineUserId, name: 'ZergRush', online: false },
    ],
    canKick: canModerate,
    canBan: canModerate,
  }
}

const whisperContext: WhisperCommandContext = {
  surface: 'whisper',
  selfUserId,
  targetId: tec27Id,
}

const lobbyContext: LobbyCommandContext = { surface: 'lobby', selfUserId }

/** A store holding only what the argument defaults read out of it. */
function fakeGetState(channels: ReadonlyArray<{ name: string; joined: boolean }>): () => RootState {
  const idToBasicInfo = new Map(
    channels.map((channel, i) => [
      makeSbChannelId(i + 1),
      { id: makeSbChannelId(i + 1), name: channel.name },
    ]),
  )
  const joinedChannels = new Set(
    channels.flatMap((channel, i) => (channel.joined ? [makeSbChannelId(i + 1)] : [])),
  )
  return () => ({ chat: { idToBasicInfo, joinedChannels } }) as unknown as RootState
}

function deps(
  context: ChannelCommandContext | WhisperCommandContext | LobbyCommandContext,
  getState: () => RootState = fakeGetState([]),
): ArgSuggestDeps {
  return { context, getState }
}

describe('messaging/commands/command-suggestions/rankByQuery', () => {
  const items = [
    { names: ['banana'] },
    { names: ['abandon'] },
    { names: ['ban'] },
    { names: ['bandana'] },
    { names: ['nothing'] },
  ]
  const getNames = (item: { names: string[] }) => item.names

  test('exact beats prefix beats fuzzy, each in the order given', () => {
    expect(rankByQuery(items, getNames, 'ban').map(i => i.names[0])).toEqual([
      'ban',
      'banana',
      'bandana',
      'abandon',
    ])
  })

  test('matching ignores case', () => {
    expect(rankByQuery(items, getNames, 'BAN')[0].names[0]).toBe('ban')
  })

  test('any of an item names can be the one that matches', () => {
    const withAliases = [{ names: ['join', 'j', 'channel'] }, { names: ['jump'] }]

    expect(rankByQuery(withAliases, getNames, 'j').map(i => i.names[0])).toEqual(['join', 'jump'])
  })

  test('an empty query keeps everything in the order given', () => {
    expect(rankByQuery(items, getNames, '')).toEqual(items)
  })

  test('items that match nothing are left out', () => {
    expect(rankByQuery(items, getNames, 'zzzz')).toEqual([])
  })
})

describe('messaging/commands/command-suggestions/matchCommands', () => {
  test('only the commands of the surface are offered', () => {
    expect(matchCommands(ALL_COMMANDS, channelContext(true), '', t).map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'kick',
      'ban',
      'me',
    ])
    expect(matchCommands(ALL_COMMANDS, whisperContext, '', t).map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'close',
      'me',
    ])
    expect(matchCommands(ALL_COMMANDS, lobbyContext, '', t).map(c => c.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'me',
    ])
  })

  test('an alias reaches its command', () => {
    expect(matchCommands(ALL_COMMANDS, channelContext(true), 'w', t).map(c => c.name)).toEqual([
      'whisper',
    ])
  })

  test('a command of another surface is not offered', () => {
    expect(matchCommands(ALL_COMMANDS, channelContext(), 'close', t)).toEqual([])
  })

  test('a command that cannot be run here is left out', () => {
    expect(matchCommands(ALL_COMMANDS, channelContext(false), 'kick', t)).toEqual([])
    expect(matchCommands(ALL_COMMANDS, channelContext(true), 'kick', t).map(c => c.name)).toEqual([
      'kick',
    ])
  })
})

describe('messaging/commands/command-suggestions/getRunnableCommands', () => {
  test('a moderation command is excluded without permission to run it', () => {
    const names = getRunnableCommands(ALL_COMMANDS, channelContext(false), t).map(c => c.name)

    expect(names).not.toContain('kick')
    expect(names).not.toContain('ban')
  })

  test('a moderation command is included with permission to run it', () => {
    const names = getRunnableCommands(ALL_COMMANDS, channelContext(true), t).map(c => c.name)

    expect(names).toContain('kick')
    expect(names).toContain('ban')
  })

  test('a command of another surface is excluded regardless of permission', () => {
    const names = getRunnableCommands(ALL_COMMANDS, channelContext(true), t).map(c => c.name)

    expect(names).not.toContain('close')
  })
})

describe('messaging/commands/command-suggestions/getArgSuggestions', () => {
  test('a user argument offers the members of the channel, other than the caller', () => {
    const arg: CommandArg = { kind: 'user', name: 'user' }

    expect(getArgSuggestions(arg, deps(channelContext()))).toEqual([
      { value: 'tec27', user: { id: tec27Id, online: true } },
      { value: 'ZergRush', user: { id: offlineUserId, online: false } },
    ])
  })

  test('a user argument leaves out the caller no matter where they fall in the list', () => {
    const arg: CommandArg = { kind: 'user', name: 'user' }
    const context: ChannelCommandContext = {
      surface: 'channel',
      channelId: makeSbChannelId(1),
      selfUserId,
      members: [
        { id: tec27Id, name: 'tec27', online: true },
        { id: selfUserId, name: 'Marko', online: true },
        { id: offlineUserId, name: 'ZergRush', online: false },
      ],
      canKick: false,
      canBan: false,
    }

    expect(getArgSuggestions(arg, deps(context))).toEqual([
      { value: 'tec27', user: { id: tec27Id, online: true } },
      { value: 'ZergRush', user: { id: offlineUserId, online: false } },
    ])
  })

  test('a surface with no member list offers nobody', () => {
    const arg: CommandArg = { kind: 'user', name: 'user' }

    expect(getArgSuggestions(arg, deps(whisperContext))).toEqual([])
    expect(getArgSuggestions(arg, deps(lobbyContext))).toEqual([])
  })

  test('a channel argument offers joined channels ahead of the rest', () => {
    const arg: CommandArg = { kind: 'channel', name: 'channel' }
    const getState = fakeGetState([
      { name: 'ShieldBattery', joined: false },
      { name: 'sb-dev', joined: true },
    ])

    expect(getArgSuggestions(arg, deps(channelContext(), getState))).toEqual([
      { value: 'sb-dev' },
      { value: 'ShieldBattery' },
    ])
  })

  test('an enum argument offers its values', () => {
    const arg: CommandArg = { kind: 'enum', name: 'mode', values: ['add', 'remove'] }

    expect(getArgSuggestions(arg, deps(channelContext()))).toEqual([
      { value: 'add' },
      { value: 'remove' },
    ])
  })

  test('a subcommand argument offers its option names', () => {
    const arg: CommandArg = {
      kind: 'subcommand',
      name: 'action',
      options: [
        { name: 'add', description: () => 'add', args: [] },
        { name: 'list', description: () => 'list', args: [] },
      ],
    }

    expect(getArgSuggestions(arg, deps(channelContext()))).toEqual([
      { value: 'add' },
      { value: 'list' },
    ])
  })

  test('free-form arguments have nothing to offer', () => {
    const context = deps(channelContext())

    expect(getArgSuggestions({ kind: 'word', name: 'word' }, context)).toEqual([])
    expect(getArgSuggestions({ kind: 'rest', name: 'rest' }, context)).toEqual([])
    expect(getArgSuggestions({ kind: 'duration', name: 'length' }, context)).toEqual([])
    expect(getArgSuggestions({ kind: 'number', name: 'amount' }, context)).toEqual([])
  })

  test('an argument own suggestions replace what its kind implies', () => {
    const arg: CommandArg = {
      kind: 'user',
      name: 'user',
      suggest: ({ context }) => [{ value: context.surface }],
    }

    expect(getArgSuggestions(arg, deps(channelContext()))).toEqual([{ value: 'channel' }])
  })
})

describe('messaging/commands/command-suggestions/filterArgSuggestions', () => {
  const suggestions = [{ value: 'Marko' }, { value: 'tec27' }, { value: 'teller' }]

  test('narrows to what answers the query', () => {
    expect(filterArgSuggestions(suggestions, 'te')).toEqual([
      { value: 'tec27' },
      { value: 'teller' },
    ])
  })

  test('an empty query keeps everything', () => {
    expect(filterArgSuggestions(suggestions, '')).toEqual(suggestions)
  })
})

describe('messaging/commands/command-suggestions/whisper user suggestions', () => {
  const friendId = makeSbUserId(4)
  const offlineFriendId = makeSbUserId(5)
  const sessionId = makeSbUserId(6)
  const namelessId = makeSbUserId(7)

  /** A store holding what the whisper command reads to work out who to offer. */
  const getState = (): RootState =>
    ({
      // Kept in recency order by the whisper reducer, newest conversation first.
      whispers: { sessions: new Set([sessionId, tec27Id, namelessId]) },
      users: {
        byId: new Map([
          [selfUserId, { id: selfUserId, name: 'Marko' }],
          [tec27Id, { id: tec27Id, name: 'tec27' }],
          [offlineUserId, { id: offlineUserId, name: 'ZergRush' }],
          [friendId, { id: friendId, name: 'Friendly' }],
          [offlineFriendId, { id: offlineFriendId, name: 'Sleepy' }],
          [sessionId, { id: sessionId, name: 'Chatty' }],
        ]),
      },
      relationships: {
        friends: new Map([
          [offlineFriendId, {}],
          [friendId, {}],
          [tec27Id, {}],
        ]),
        friendActivityStatus: new Map([
          [offlineFriendId, FriendActivityStatus.Offline],
          [friendId, FriendActivityStatus.Online],
          [tec27Id, FriendActivityStatus.InGame],
        ]),
      },
    }) as unknown as RootState

  const targetArg = whisperCommand.args[0]

  test('open conversations come first, then friends, then the rest of the surface', () => {
    expect(getArgSuggestions(targetArg, deps(channelContext(), getState))).toEqual([
      { value: 'Chatty', user: { id: sessionId, online: undefined } },
      { value: 'tec27', user: { id: tec27Id, online: undefined } },
      { value: 'Friendly', user: { id: friendId, online: true } },
      { value: 'Sleepy', user: { id: offlineFriendId, online: false } },
      { value: 'ZergRush', user: { id: offlineUserId, online: false } },
    ])
  })

  test('a user reached by several sources is offered once, in the best position', () => {
    // tec27 has a conversation, is a friend, and is in the channel.
    const values = getArgSuggestions(targetArg, deps(channelContext(), getState)).map(s => s.value)

    expect(values.filter(value => value === 'tec27')).toHaveLength(1)
    expect(values.indexOf('tec27')).toBe(1)
  })

  test('the user running the command is never offered', () => {
    const values = getArgSuggestions(targetArg, deps(channelContext(), getState)).map(s => s.value)

    expect(values).not.toContain('Marko')
  })

  test('a user whose name the client does not know is skipped', () => {
    expect(getArgSuggestions(targetArg, deps(channelContext(), getState))).toHaveLength(5)
  })

  test('surfaces with no member list still offer conversations and friends', () => {
    const expected = ['Chatty', 'tec27', 'Friendly', 'Sleepy']

    expect(getArgSuggestions(targetArg, deps(whisperContext, getState)).map(s => s.value)).toEqual(
      expected,
    )
    expect(getArgSuggestions(targetArg, deps(lobbyContext, getState)).map(s => s.value)).toEqual(
      expected,
    )
  })
})
