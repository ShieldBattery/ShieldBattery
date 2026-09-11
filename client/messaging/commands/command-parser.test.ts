import { describe, expect, test } from 'vitest'
import { locateArgAtCaret, parseArgs, parseDuration, splitCommandInput } from './command-parser'
import { ChatCommand, CommandArg, defineCommand } from './command-schema'

/** A command that exists only to have its arguments read. */
function commandWithArgs<const Args extends readonly CommandArg[]>(args: Args): ChatCommand {
  return defineCommand({
    name: 'test',
    description: () => 'test',
    surfaces: ['channel'],
    args,
    run: () => {},
  })
}

describe('messaging/commands/command-parser/splitCommandInput', () => {
  test('a leading slash starts a command', () => {
    expect(splitCommandInput('/whisper tec27 hello')).toEqual({
      kind: 'command',
      name: 'whisper',
      argText: 'tec27 hello',
    })
  })

  test('a command with nothing after its name', () => {
    expect(splitCommandInput('/leave')).toEqual({ kind: 'command', name: 'leave', argText: '' })
  })

  test('the name keeps the case it was typed in', () => {
    expect(splitCommandInput('/WhisPer tec27')).toEqual({
      kind: 'command',
      name: 'WhisPer',
      argText: 'tec27',
    })
  })

  test('a lone slash is a command with no name', () => {
    expect(splitCommandInput('/')).toEqual({ kind: 'command', name: '', argText: '' })
  })

  test('leading whitespace still starts a command', () => {
    expect(splitCommandInput('   /w tec27 hi')).toEqual({
      kind: 'command',
      name: 'w',
      argText: 'tec27 hi',
    })
  })

  test('a slash anywhere but the start is text', () => {
    expect(splitCommandInput('a /w tec27')).toEqual({ kind: 'text', text: 'a /w tec27' })
  })

  test('a doubled slash escapes to text with one slash', () => {
    expect(splitCommandInput('//w hi')).toEqual({ kind: 'text', text: '/w hi' })
  })

  test('ordinary text passes through', () => {
    expect(splitCommandInput('hello there')).toEqual({ kind: 'text', text: 'hello there' })
  })
})

describe('messaging/commands/command-parser/parseDuration', () => {
  test('a single unit', () => {
    expect(parseDuration('30s')).toBe(30_000)
  })

  test('milliseconds are not read as minutes', () => {
    expect(parseDuration('500ms')).toBe(500)
    expect(parseDuration('5m')).toBe(5 * 60_000)
  })

  test('combined units', () => {
    expect(parseDuration('1h30m')).toBe(90 * 60_000)
    expect(parseDuration('2d')).toBe(2 * 24 * 60 * 60_000)
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60_000)
  })

  test('a count with no unit', () => {
    expect(parseDuration('30')).toBeUndefined()
  })

  test('an unknown unit', () => {
    expect(parseDuration('30x')).toBeUndefined()
  })

  test('trailing junk', () => {
    expect(parseDuration('30s!')).toBeUndefined()
  })

  test('nothing at all', () => {
    expect(parseDuration('')).toBeUndefined()
  })
})

describe('messaging/commands/command-parser/parseArgs', () => {
  test('a user argument keeps the typed name and strips a leading @', () => {
    const command = commandWithArgs([{ kind: 'user', name: 'user' }])

    expect(parseArgs(command, 'tec27')).toEqual({ ok: true, args: { user: 'tec27' } })
    expect(parseArgs(command, '@tec27')).toEqual({ ok: true, args: { user: 'tec27' } })
  })

  test('a name that could not be a username is invalid', () => {
    const command = commandWithArgs([{ kind: 'user', name: 'user' }])

    expect(parseArgs(command, 'way-too-long-to-be-a-username')).toEqual({
      ok: false,
      error: 'invalid',
      argName: 'user',
      value: 'way-too-long-to-be-a-username',
    })
  })

  test('a channel argument strips a leading #', () => {
    const command = commandWithArgs([{ kind: 'channel', name: 'channel' }])

    expect(parseArgs(command, '#ShieldBattery')).toEqual({
      ok: true,
      args: { channel: 'ShieldBattery' },
    })
  })

  test('a missing required argument', () => {
    const command = commandWithArgs([{ kind: 'user', name: 'user' }])

    expect(parseArgs(command, '')).toEqual({ ok: false, error: 'missing', argName: 'user' })
  })

  test('a missing optional argument parses as undefined', () => {
    const command = commandWithArgs([
      { kind: 'user', name: 'user' },
      { kind: 'rest', name: 'message', optional: true },
    ])

    expect(parseArgs(command, 'tec27')).toEqual({
      ok: true,
      args: { user: 'tec27', message: undefined },
    })
  })

  test('a rest argument keeps spaces, quotes and slashes', () => {
    const command = commandWithArgs([
      { kind: 'user', name: 'user' },
      { kind: 'rest', name: 'message', optional: true },
    ])

    expect(parseArgs(command, 'tec27    hey  "you"  /leave')).toEqual({
      ok: true,
      args: { user: 'tec27', message: 'hey  "you"  /leave' },
    })
  })

  test('a word argument takes one token', () => {
    const command = commandWithArgs([{ kind: 'word', name: 'word' }])

    expect(parseArgs(command, 'one')).toEqual({ ok: true, args: { word: 'one' } })
  })

  test('a quoted word argument takes the whole run without its quotes', () => {
    const command = commandWithArgs([{ kind: 'word', name: 'word' }])

    expect(parseArgs(command, '"multi word value"')).toEqual({
      ok: true,
      args: { word: 'multi word value' },
    })
  })

  test('an enum argument matches without regard to case and answers with the declared spelling', () => {
    const command = commandWithArgs([{ kind: 'enum', name: 'mode', values: ['add', 'remove'] }])

    expect(parseArgs(command, 'REMOVE')).toEqual({ ok: true, args: { mode: 'remove' } })
  })

  test('a value the enum does not list is invalid', () => {
    const command = commandWithArgs([{ kind: 'enum', name: 'mode', values: ['add', 'remove'] }])

    expect(parseArgs(command, 'destroy')).toEqual({
      ok: false,
      error: 'invalid',
      argName: 'mode',
      value: 'destroy',
    })
  })

  test('a duration argument parses to milliseconds', () => {
    const command = commandWithArgs([{ kind: 'duration', name: 'length' }])

    expect(parseArgs(command, '1h30m')).toEqual({ ok: true, args: { length: 90 * 60_000 } })
  })

  test('a duration that cannot be read is invalid', () => {
    const command = commandWithArgs([{ kind: 'duration', name: 'length' }])

    expect(parseArgs(command, 'forever')).toEqual({
      ok: false,
      error: 'invalid',
      argName: 'length',
      value: 'forever',
    })
  })

  test('a number argument parses to a number', () => {
    const command = commandWithArgs([{ kind: 'number', name: 'amount' }])

    expect(parseArgs(command, '4.5')).toEqual({ ok: true, args: { amount: 4.5 } })
  })

  test('a number outside its bounds or off its step is invalid', () => {
    const command = commandWithArgs([
      { kind: 'number', name: 'amount', integer: true, min: 1, max: 10 },
    ])

    expect(parseArgs(command, '4.5')).toEqual({
      ok: false,
      error: 'invalid',
      argName: 'amount',
      value: '4.5',
    })
    expect(parseArgs(command, '11')).toEqual({
      ok: false,
      error: 'invalid',
      argName: 'amount',
      value: '11',
    })
    expect(parseArgs(command, 'lots')).toEqual({
      ok: false,
      error: 'invalid',
      argName: 'amount',
      value: 'lots',
    })
  })

  test('a subcommand picks an option and parses that option arguments', () => {
    const command = commandWithArgs([
      {
        kind: 'subcommand',
        name: 'action',
        options: [
          {
            name: 'add',
            aliases: ['a'],
            description: () => 'add',
            args: [{ kind: 'user', name: 'user' }],
          },
          { name: 'list', description: () => 'list', args: [] },
        ],
      },
    ])

    expect(parseArgs(command, 'ADD tec27')).toEqual({
      ok: true,
      args: { action: { name: 'add', args: { user: 'tec27' } } },
    })
    expect(parseArgs(command, 'a @tec27')).toEqual({
      ok: true,
      args: { action: { name: 'add', args: { user: 'tec27' } } },
    })
    expect(parseArgs(command, 'list')).toEqual({
      ok: true,
      args: { action: { name: 'list', args: {} } },
    })
  })

  test('a subcommand option that was not declared is invalid', () => {
    const command = commandWithArgs([
      {
        kind: 'subcommand',
        name: 'action',
        options: [{ name: 'list', description: () => 'list', args: [] }],
      },
    ])

    expect(parseArgs(command, 'destroy')).toEqual({
      ok: false,
      error: 'invalid',
      argName: 'action',
      value: 'destroy',
    })
  })

  test('a subcommand option missing one of its own arguments', () => {
    const command = commandWithArgs([
      {
        kind: 'subcommand',
        name: 'action',
        options: [
          { name: 'add', description: () => 'add', args: [{ kind: 'user', name: 'user' }] },
        ],
      },
    ])

    expect(parseArgs(command, 'add')).toEqual({ ok: false, error: 'missing', argName: 'user' })
  })

  test('anything typed past the last argument is too much', () => {
    const command = commandWithArgs([{ kind: 'channel', name: 'channel' }])

    expect(parseArgs(command, 'ShieldBattery and more')).toEqual({
      ok: false,
      error: 'extra',
      value: 'and more',
    })
  })

  test('a command that takes no arguments takes no text either', () => {
    const command = commandWithArgs([])

    expect(parseArgs(command, '')).toEqual({ ok: true, args: {} })
    expect(parseArgs(command, 'now')).toEqual({ ok: false, error: 'extra', value: 'now' })
  })
})

describe('messaging/commands/command-parser/locateArgAtCaret', () => {
  const userAndReason = commandWithArgs([
    { kind: 'user', name: 'user' },
    { kind: 'rest', name: 'reason', optional: true },
  ])

  test('nothing typed yet starts on the first argument', () => {
    expect(locateArgAtCaret(userAndReason, '')).toEqual({
      activeArg: { kind: 'user', name: 'user' },
      token: { start: 0, text: '' },
    })
  })

  test('the whitespace after the name still sits on the first argument', () => {
    const caret = locateArgAtCaret(userAndReason, ' ')

    expect(caret.activeArg).toEqual({ kind: 'user', name: 'user' })
    expect(caret.token).toEqual({ start: 1, text: '' })
  })

  test('a partly typed value is the active token', () => {
    const caret = locateArgAtCaret(userAndReason, ' tec')

    expect(caret.activeArg).toEqual({ kind: 'user', name: 'user' })
    expect(caret.token).toEqual({ start: 1, text: 'tec' })
  })

  test('whitespace after a complete value moves on to the next argument', () => {
    const caret = locateArgAtCaret(userAndReason, ' tec27 ')

    expect(caret.activeArg).toEqual({ kind: 'rest', name: 'reason', optional: true })
    expect(caret.token).toEqual({ start: 7, text: '' })
  })

  test('a rest argument holds everything left, spaces and all', () => {
    const caret = locateArgAtCaret(userAndReason, ' tec27 some reason')

    expect(caret.activeArg).toEqual({ kind: 'rest', name: 'reason', optional: true })
    expect(caret.token).toEqual({ start: 7, text: 'some reason' })
  })

  test('the token keeps the sigil it was typed with', () => {
    const caret = locateArgAtCaret(userAndReason, ' @tec')

    expect(caret.token).toEqual({ start: 1, text: '@tec' })
  })

  test('a word argument keeps its quotes in the token', () => {
    const command = commandWithArgs([
      { kind: 'word', name: 'word' },
      { kind: 'rest', name: 'rest', optional: true },
    ])
    const caret = locateArgAtCaret(command, ' "multi word')

    expect(caret.activeArg).toEqual({ kind: 'word', name: 'word' })
    expect(caret.token).toEqual({ start: 1, text: '"multi word' })
  })

  test('a caret past every argument is in none of them', () => {
    const command = commandWithArgs([{ kind: 'channel', name: 'channel' }])

    expect(locateArgAtCaret(command, ' sb ')).toEqual({
      activeArg: undefined,
      token: undefined,
    })
  })

  test('a command with no arguments has nothing to be in', () => {
    expect(locateArgAtCaret(commandWithArgs([]), '')).toEqual({
      activeArg: undefined,
      token: undefined,
    })
  })

  const subcommand = commandWithArgs([
    {
      kind: 'subcommand',
      name: 'action',
      options: [
        {
          name: 'add',
          aliases: ['a'],
          description: () => 'add',
          args: [{ kind: 'user', name: 'user' }],
        },
        { name: 'list', description: () => 'list', args: [] },
      ],
    },
  ])

  test('a subcommand starts on its own name', () => {
    const caret = locateArgAtCaret(subcommand, ' ad')

    expect(caret.activeArg?.name).toBe('action')
    expect(caret.token).toEqual({ start: 1, text: 'ad' })
  })

  test('a named option continues into its own arguments', () => {
    const caret = locateArgAtCaret(subcommand, ' add ')

    expect(caret.activeArg).toEqual({ kind: 'user', name: 'user' })
    expect(caret.token).toEqual({ start: 5, text: '' })
  })

  test('an alias reaches the same option', () => {
    const caret = locateArgAtCaret(subcommand, ' a tec')

    expect(caret.activeArg).toEqual({ kind: 'user', name: 'user' })
    expect(caret.token).toEqual({ start: 3, text: 'tec' })
  })

  test('nothing is known past an option name that was never declared', () => {
    const caret = locateArgAtCaret(subcommand, ' nope tec')

    expect(caret.activeArg).toBeUndefined()
    expect(caret.token).toBeUndefined()
  })
})
