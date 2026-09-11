import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { makeSbChannelId } from '../../../common/chat'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { RootState } from '../../root-reducer'
import {
  ChannelCommandContext,
  LobbyCommandContext,
  WhisperCommandContext,
} from './command-context'
import { ALL_COMMANDS } from './command-registry'
import { ArgSuggestDeps, CommandArg } from './command-schema'
import {
  filterArgSuggestions,
  getArgSuggestions,
  matchCommands,
  rankByQuery,
} from './command-suggestions'

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
    expect(matchCommands(ALL_COMMANDS, channelContext(), '', t).map(m => m.command.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'kick',
      'ban',
      'me',
    ])
    expect(matchCommands(ALL_COMMANDS, whisperContext, '', t).map(m => m.command.name)).toEqual([
      'help',
      'join',
      'whisper',
      'close',
      'me',
    ])
    expect(matchCommands(ALL_COMMANDS, lobbyContext, '', t).map(m => m.command.name)).toEqual([
      'help',
      'join',
      'whisper',
      'leave',
      'me',
    ])
  })

  test('an alias reaches its command', () => {
    expect(matchCommands(ALL_COMMANDS, channelContext(), 'w', t).map(m => m.command.name)).toEqual([
      'whisper',
    ])
  })

  test('a command of another surface is not offered', () => {
    expect(matchCommands(ALL_COMMANDS, channelContext(), 'close', t)).toEqual([])
  })

  test('a command that cannot be run here is still listed, with its reason', () => {
    const [kick] = matchCommands(ALL_COMMANDS, channelContext(false), 'kick', t)

    expect(kick.command.name).toBe('kick')
    expect(kick.unavailableReason).toBe(
      "You don't have permission to kick users from this channel.",
    )
    expect(
      matchCommands(ALL_COMMANDS, channelContext(true), 'kick', t)[0].unavailableReason,
    ).toBeUndefined()
  })
})

describe('messaging/commands/command-suggestions/getArgSuggestions', () => {
  test('a user argument offers the members of the channel', () => {
    const arg: CommandArg = { kind: 'user', name: 'user' }

    expect(getArgSuggestions(arg, deps(channelContext()))).toEqual([
      { value: 'Marko', user: { id: selfUserId, online: true } },
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
