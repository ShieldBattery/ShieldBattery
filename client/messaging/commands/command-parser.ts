import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidChannelName, isValidUsername } from '../../../common/constants'
import {
  ChatCommand,
  CommandArg,
  ParsedArgValues,
  ParsedSubcommand,
  SubcommandOption,
} from './command-schema'

/** What a submitted input turns out to be. */
export type SplitCommandInput =
  /** Ordinary chat text, with a `//` escape already reduced to a single leading slash. */
  | { kind: 'text'; text: string }
  /**
   * A command: `name` is spelled the way it was typed (the lookup ignores case), and `argText` is
   * everything after it, trimmed.
   */
  | { kind: 'command'; name: string; argText: string }

/**
 * Decides whether a submitted input names a command. Only a `/` at the very start of the trimmed
 * input starts one; `//` escapes to text carrying a single leading slash.
 */
export function splitCommandInput(input: string): SplitCommandInput {
  const trimmed = input.trim()

  if (!trimmed.startsWith('/')) {
    return { kind: 'text', text: trimmed }
  }
  if (trimmed.startsWith('//')) {
    return { kind: 'text', text: trimmed.slice(1) }
  }

  const afterSlash = trimmed.slice(1)
  const nameEnd = afterSlash.search(/\s/)
  return nameEnd === -1
    ? { kind: 'command', name: afterSlash, argText: '' }
    : {
        kind: 'command',
        name: afterSlash.slice(0, nameEnd),
        argText: afterSlash.slice(nameEnd).trim(),
      }
}

/** Why a command's arguments couldn't be parsed. */
export type ParseArgsFailure =
  /** A required argument wasn't typed at all. */
  | { ok: false; error: 'missing'; argName: string }
  /** An argument was typed, but not in a form it accepts. */
  | { ok: false; error: 'invalid'; argName: string; value: string }
  /** Something was typed past the last argument the command takes. */
  | { ok: false; error: 'extra'; value: string }

export type ParseArgsResult = { ok: true; args: ParsedArgValues } | ParseArgsFailure

const MILLIS_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['ms', 1],
  ['s', 1000],
  ['m', 60 * 1000],
  ['h', 60 * 60 * 1000],
  ['d', 24 * 60 * 60 * 1000],
  ['w', 7 * 24 * 60 * 60 * 1000],
])

// Sticky, so the parts have to sit flush against each other. Longer unit names come first so `ms`
// is never read as `m` followed by a stray `s`.
const DURATION_PART = /(\d+)(ms|s|m|h|d|w)/iy

/**
 * Reads a length of time such as `30s`, `1h30m` or `2d` as milliseconds. Returns undefined unless
 * the whole value is made of count/unit pairs with nothing between or around them.
 */
export function parseDuration(value: string): number | undefined {
  DURATION_PART.lastIndex = 0
  let total = 0
  let parts = 0
  // A sticky regex resets `lastIndex` to 0 when it stops matching, so how far it got has to be
  // remembered as it goes.
  let consumed = 0

  let match = DURATION_PART.exec(value)
  while (match) {
    total += Number(match[1]) * MILLIS_PER_UNIT.get(match[2].toLowerCase())!
    parts += 1
    consumed = DURATION_PART.lastIndex
    match = DURATION_PART.exec(value)
  }

  return parts > 0 && consumed === value.length ? total : undefined
}

const WHITESPACE = /\s/

/**
 * Hands out the pieces of a command's argument text: one token at a time, or everything that's
 * left in one piece.
 */
class ArgTokenizer {
  private pos = 0

  constructor(private readonly text: string) {}

  /** How far into the text the reading has got, as an index into it. */
  get position(): number {
    return this.pos
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && WHITESPACE.test(this.text[this.pos])) {
      this.pos += 1
    }
  }

  /** Whether nothing but whitespace is left. */
  atEnd(): boolean {
    this.skipWhitespace()
    return this.pos >= this.text.length
  }

  /** Reads the next whitespace-delimited token, or undefined if nothing is left. */
  nextToken(): string | undefined {
    this.skipWhitespace()
    if (this.pos >= this.text.length) {
      return undefined
    }

    const start = this.pos
    while (this.pos < this.text.length && !WHITESPACE.test(this.text[this.pos])) {
      this.pos += 1
    }
    return this.text.slice(start, this.pos)
  }

  /**
   * Reads the next token, or the contents of a double-quoted run as one value. A run that is never
   * closed reaches to the end of the text.
   */
  nextWord(): string | undefined {
    this.skipWhitespace()
    if (this.pos >= this.text.length) {
      return undefined
    }
    if (this.text[this.pos] !== '"') {
      return this.nextToken()
    }

    this.pos += 1
    const start = this.pos
    while (this.pos < this.text.length && this.text[this.pos] !== '"') {
      this.pos += 1
    }
    const value = this.text.slice(start, this.pos)
    if (this.pos < this.text.length) {
      this.pos += 1
    }
    return value
  }

  /** Reads everything that's left, verbatim apart from the whitespace in front of it. */
  rest(): string {
    this.skipWhitespace()
    const value = this.text.slice(this.pos)
    this.pos = this.text.length
    return value
  }
}

type ArgResult =
  /** Nothing was typed for this argument. */
  | { kind: 'absent' }
  | { kind: 'value'; value: string | number | ParsedSubcommand }
  | { kind: 'failure'; failure: ParseArgsFailure }

function invalid(argName: string, value: string): ArgResult {
  return { kind: 'failure', failure: { ok: false, error: 'invalid', argName, value } }
}

function matchesOption(option: SubcommandOption, name: string): boolean {
  const lowered = name.toLowerCase()
  return (
    option.name.toLowerCase() === lowered ||
    (option.aliases?.some(alias => alias.toLowerCase() === lowered) ?? false)
  )
}

function parseArg(arg: CommandArg, tokenizer: ArgTokenizer): ArgResult {
  switch (arg.kind) {
    case 'user': {
      const token = tokenizer.nextToken()
      if (token === undefined) {
        return { kind: 'absent' }
      }
      const name = token.startsWith('@') ? token.slice(1) : token
      return isValidUsername(name) ? { kind: 'value', value: name } : invalid(arg.name, token)
    }

    case 'channel': {
      const token = tokenizer.nextToken()
      if (token === undefined) {
        return { kind: 'absent' }
      }
      const name = token.startsWith('#') ? token.slice(1) : token
      return isValidChannelName(name) ? { kind: 'value', value: name } : invalid(arg.name, token)
    }

    case 'word': {
      const word = tokenizer.nextWord()
      return word === undefined ? { kind: 'absent' } : { kind: 'value', value: word }
    }

    case 'rest': {
      const rest = tokenizer.rest()
      return rest.length > 0 ? { kind: 'value', value: rest } : { kind: 'absent' }
    }

    case 'enum': {
      const token = tokenizer.nextToken()
      if (token === undefined) {
        return { kind: 'absent' }
      }
      const value = arg.values.find(v => v.toLowerCase() === token.toLowerCase())
      return value !== undefined ? { kind: 'value', value } : invalid(arg.name, token)
    }

    case 'duration': {
      const token = tokenizer.nextToken()
      if (token === undefined) {
        return { kind: 'absent' }
      }
      const millis = parseDuration(token)
      return millis !== undefined ? { kind: 'value', value: millis } : invalid(arg.name, token)
    }

    case 'number': {
      const token = tokenizer.nextToken()
      if (token === undefined) {
        return { kind: 'absent' }
      }
      const value = Number(token)
      if (
        !Number.isFinite(value) ||
        (arg.integer && !Number.isInteger(value)) ||
        (arg.min !== undefined && value < arg.min) ||
        (arg.max !== undefined && value > arg.max)
      ) {
        return invalid(arg.name, token)
      }
      return { kind: 'value', value }
    }

    case 'subcommand': {
      const token = tokenizer.nextToken()
      if (token === undefined) {
        return { kind: 'absent' }
      }
      const option = arg.options.find(o => matchesOption(o, token))
      if (!option) {
        return invalid(arg.name, token)
      }

      const optionArgs: Record<string, string | number | ParsedSubcommand | undefined> = {}
      const failure = parseArgList(option.args, tokenizer, optionArgs)
      return failure
        ? { kind: 'failure', failure }
        : { kind: 'value', value: { name: option.name, args: optionArgs } }
    }

    default:
      return assertUnreachable(arg)
  }
}

function parseArgList(
  argList: readonly CommandArg[],
  tokenizer: ArgTokenizer,
  out: Record<string, string | number | ParsedSubcommand | undefined>,
): ParseArgsFailure | undefined {
  for (const arg of argList) {
    const result = parseArg(arg, tokenizer)

    if (result.kind === 'failure') {
      return result.failure
    } else if (result.kind === 'absent') {
      if (!arg.optional) {
        return { ok: false, error: 'missing', argName: arg.name }
      }
      out[arg.name] = undefined
    } else {
      out[arg.name] = result.value
    }
  }

  return undefined
}

/** Reads the text typed after a command's name into the arguments the command declared. */
export function parseArgs(command: ChatCommand, argText: string): ParseArgsResult {
  const tokenizer = new ArgTokenizer(argText)
  const args: Record<string, string | number | ParsedSubcommand | undefined> = {}

  const failure = parseArgList(command.args, tokenizer, args)
  if (failure) {
    return failure
  }
  if (!tokenizer.atEnd()) {
    return { ok: false, error: 'extra', value: tokenizer.rest() }
  }

  return { ok: true, args }
}

/** Where the caret sits among a command's arguments. */
export interface ArgCaret {
  /**
   * The schema entry the caret is in, or undefined when the caret is past every argument the
   * command takes (or in text no argument accepts).
   */
  activeArg: CommandArg | undefined
  /**
   * What has been typed for the active argument so far, and where it starts in
   * `argTextBeforeCaret`. `text` is empty when the argument has not been started. Defined exactly
   * when `activeArg` is.
   */
  token: { start: number; text: string } | undefined
}

/**
 * Reads `args` the way the parser would, stopping at whichever one the end of `text` falls in.
 * Nothing past the caret is read, so the arguments after the active one are never looked at.
 * Undefined means the caret is past every argument that could be read.
 */
function walkArgsToCaret(
  args: readonly CommandArg[],
  tokenizer: ArgTokenizer,
  text: string,
): ArgCaret | undefined {
  for (const arg of args) {
    // This also skips the whitespace in front of the value, so the position below is where the
    // value itself starts.
    if (tokenizer.atEnd()) {
      return { activeArg: arg, token: { start: text.length, text: '' } }
    }

    const start = tokenizer.position
    if (arg.kind === 'rest') {
      // Everything left over is one value, so a caret anywhere past here is inside it.
      tokenizer.rest()
      return { activeArg: arg, token: { start, text: text.slice(start) } }
    } else if (arg.kind === 'word') {
      tokenizer.nextWord()
    } else {
      tokenizer.nextToken()
    }

    if (tokenizer.position >= text.length) {
      return { activeArg: arg, token: { start, text: text.slice(start) } }
    }

    // The value is complete and more was typed after it, so the caret is in a later argument.
    if (arg.kind === 'subcommand') {
      const option = arg.options.find(o => matchesOption(o, text.slice(start, tokenizer.position)))
      // Nothing is known about what follows a name no option answers to.
      return option ? walkArgsToCaret(option.args, tokenizer, text) : undefined
    }
  }

  return undefined
}

/**
 * Finds which argument the caret is in. `argTextBeforeCaret` is the text after the command name
 * (it may start with whitespace) up to the caret; nothing after the caret matters.
 */
export function locateArgAtCaret(command: ChatCommand, argTextBeforeCaret: string): ArgCaret {
  return (
    walkArgsToCaret(command.args, new ArgTokenizer(argTextBeforeCaret), argTextBeforeCaret) ?? {
      activeArg: undefined,
      token: undefined,
    }
  )
}
