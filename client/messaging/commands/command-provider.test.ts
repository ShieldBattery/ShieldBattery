import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { makeSbChannelId } from '../../../common/chat'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { RootState } from '../../root-reducer'
import { TypeaheadMatch, TypeaheadSuggestion } from '../typeahead'
import { ChannelCommandContext } from './command-context'
import {
  createCommandArgProvider,
  createCommandNameProvider,
  locateCommandCaret,
} from './command-provider'
import { ALL_COMMANDS } from './command-registry'

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

const shieldBatteryId = makeSbChannelId(1)
const devId = makeSbChannelId(2)

/** A store holding only what the argument defaults read out of it. */
const getState = (): RootState =>
  ({
    chat: {
      idToBasicInfo: new Map([
        [shieldBatteryId, { id: shieldBatteryId, name: 'ShieldBattery' }],
        [devId, { id: devId, name: 'sb-dev' }],
      ]),
      joinedChannels: new Set([devId]),
    },
  }) as unknown as RootState

function nameMatch(text: string, canModerate = false): TypeaheadMatch | undefined {
  return createCommandNameProvider({ context: channelContext(canModerate), getState, t }).match(
    text,
  )
}

function argMatch(text: string, canModerate = false): TypeaheadMatch | undefined {
  return createCommandArgProvider({ context: channelContext(canModerate), getState, t }).match(text)
}

/** The rows of a match the command palettes produce, which are never loaded asynchronously. */
function rows(match: TypeaheadMatch | undefined): ReadonlyArray<TypeaheadSuggestion> {
  const suggestions = match!.suggestions
  if (suggestions instanceof Promise) {
    throw new Error('the command palettes offer their rows synchronously')
  }
  return suggestions
}

describe('messaging/commands/command-provider/locateCommandCaret', () => {
  test('ordinary text is not a command', () => {
    expect(locateCommandCaret('hello', ALL_COMMANDS, 'channel')).toEqual({ kind: 'none' })
    expect(locateCommandCaret('', ALL_COMMANDS, 'channel')).toEqual({ kind: 'none' })
    expect(locateCommandCaret('say /leave', ALL_COMMANDS, 'channel')).toEqual({ kind: 'none' })
  })

  test('the doubled-slash escape is not a command', () => {
    expect(locateCommandCaret('//lea', ALL_COMMANDS, 'channel')).toEqual({ kind: 'none' })
  })

  test('a name still being typed', () => {
    expect(locateCommandCaret('/', ALL_COMMANDS, 'channel')).toEqual({
      kind: 'name',
      start: 0,
      query: '',
    })
    expect(locateCommandCaret('/ki', ALL_COMMANDS, 'channel')).toEqual({
      kind: 'name',
      start: 0,
      query: 'ki',
    })
  })

  test('leading whitespace still starts a command', () => {
    expect(locateCommandCaret('  /ki', ALL_COMMANDS, 'channel')).toEqual({
      kind: 'name',
      start: 2,
      query: 'ki',
    })
  })

  test('a complete name puts the caret in the arguments', () => {
    const caret = locateCommandCaret('/kick te', ALL_COMMANDS, 'channel')

    expect(caret.kind).toBe('args')
    if (caret.kind !== 'args') return
    expect(caret.command.name).toBe('kick')
    expect(caret.argStart).toBe(5)
    expect(caret.caret.activeArg).toEqual({ kind: 'user', name: 'user' })
    expect(caret.caret.token).toEqual({ start: 1, text: 'te' })
  })

  test('a command that cannot be run here still has arguments', () => {
    const caret = locateCommandCaret('/kick ', ALL_COMMANDS, 'channel')

    expect(caret.kind).toBe('args')
  })

  test('a name no command of this surface answers to', () => {
    expect(locateCommandCaret('/nope ', ALL_COMMANDS, 'channel')).toEqual({ kind: 'unknown' })
    // `close` exists, but only in whispers.
    expect(locateCommandCaret('/close ', ALL_COMMANDS, 'channel')).toEqual({ kind: 'unknown' })
    expect(locateCommandCaret('/close ', ALL_COMMANDS, 'whisper').kind).toBe('args')
  })
})

describe('messaging/commands/command-provider/createCommandNameProvider', () => {
  test('a lone slash lists the commands of the surface', () => {
    const match = nameMatch('/')

    expect(match).toMatchObject({
      start: 0,
      matchedText: '/',
      submitOnExact: true,
      spaceAcceptsSingle: false,
    })
    expect(rows(match).map(r => r.text)).toEqual([
      '/help [command]',
      '/join <channel>',
      '/whisper <user> [message]',
      '/leave',
      '/kick <user> [reason]',
      '/ban <user> [reason]',
      '/me <action>',
    ])
  })

  test('a command that cannot be run here carries its reason', () => {
    const kick = rows(nameMatch('/')).find(r => r.text.startsWith('/kick'))!

    expect(kick.visual).toEqual({
      kind: 'command',
      command: expect.objectContaining({ name: 'kick' }),
      description: 'Kicks a user out of this channel.',
      unavailableReason: "You don't have permission to kick users from this channel.",
    })
  })

  test('a command that can be run here has no reason', () => {
    const kick = rows(nameMatch('/', true)).find(r => r.text.startsWith('/kick'))!

    expect(kick.visual).toMatchObject({
      description: 'Kicks a user out of this channel.',
      unavailableReason: undefined,
    })
  })

  test('an alias narrows to its command', () => {
    const match = nameMatch('/w')
    const [whisper] = rows(match)

    expect(rows(match)).toHaveLength(1)
    expect(whisper.key).toBe('command:whisper')
    expect(whisper.insertText).toBe('/whisper ')
    // The alias spells the command out, so Enter sends rather than completing it.
    expect(whisper.exact).toBe(true)
    expect(match!.matchedText).toBe('/w')
    // Something has been typed towards the row, so a space may take it.
    expect(match!.spaceAcceptsSingle).toBe(true)
  })

  test('a command of another surface is not offered', () => {
    expect(rows(nameMatch('/close'))).toEqual([])
  })

  test('a name still being typed is not exact', () => {
    expect(rows(nameMatch('/ki'))[0].exact).toBe(false)
  })

  test('the doubled-slash escape is left alone', () => {
    expect(nameMatch('//w')).toBeUndefined()
  })

  test('a complete name is the argument palette business', () => {
    expect(nameMatch('/kick ')).toBeUndefined()
  })
})

describe('messaging/commands/command-provider/createCommandArgProvider', () => {
  test('a user argument offers the members of the channel', () => {
    const match = argMatch('/kick ')

    expect(match).toMatchObject({
      start: 6,
      matchedText: '',
      submitOnExact: true,
      spaceAcceptsSingle: false,
    })
    expect(rows(match).map(r => r.text)).toEqual(['Marko', 'tec27', 'ZergRush'])
    expect(rows(match)[2]).toMatchObject({
      key: 'argument:ZergRush',
      insertText: 'ZergRush ',
      visual: { kind: 'user', userId: offlineUserId, online: false },
      exact: false,
    })
  })

  test('what has been typed narrows the members', () => {
    const match = argMatch('/kick te')

    expect(match).toMatchObject({ start: 6, matchedText: 'te', spaceAcceptsSingle: true })
    expect(rows(match).map(r => r.text)).toEqual(['tec27'])
  })

  test('a typed sigil is kept rather than completed over', () => {
    const match = argMatch('/kick @te')

    expect(match).toMatchObject({ start: 6, matchedText: '@te' })
    expect(rows(match)[0]).toMatchObject({ text: 'tec27', insertText: '@tec27 ' })
  })

  test('a fully typed value is exact', () => {
    expect(rows(argMatch('/kick TEC27'))[0]).toMatchObject({ text: 'tec27', exact: true })
  })

  test('a channel argument offers joined channels first', () => {
    const match = argMatch('/join ')

    expect(rows(match).map(r => r.text)).toEqual(['sb-dev', 'ShieldBattery'])
    expect(rows(match)[0]).toMatchObject({ visual: { kind: 'plain' }, insertText: 'sb-dev ' })
  })

  test('a channel sigil is kept too', () => {
    expect(rows(argMatch('/join #sb'))[0]).toMatchObject({ insertText: '#sb-dev ' })
  })

  test('an argument with nothing to complete leaves the caret alone', () => {
    // `/me` takes a `rest` argument, which is where mentions and emotes get to run.
    expect(argMatch('/me hel')).toBeUndefined()
    // The reason a kick is given is a `rest` argument as well.
    expect(argMatch('/kick tec27 bec')).toBeUndefined()
  })

  test('a caret past every argument has no argument to complete', () => {
    expect(argMatch('/leave ')).toBeUndefined()
  })

  test('the name palette owns a name still being typed', () => {
    expect(argMatch('/kic')).toBeUndefined()
    expect(argMatch('//kick ')).toBeUndefined()
    expect(argMatch('hello ')).toBeUndefined()
  })
})
