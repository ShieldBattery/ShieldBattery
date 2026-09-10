import { TFunction } from 'i18next'
import { ReduxAction } from '../../action-types'
import { DispatchFunction } from '../../dispatch-registry'
import { CommandContext, CommandSurface } from './command-context'
import { LocalLineEmitter } from './local-output'

/** Every surface a command can be declared for, in no particular order. */
export const ALL_COMMAND_SURFACES: ReadonlyArray<CommandSurface> = ['channel', 'whisper', 'lobby']

interface BaseArg {
  /**
   * An English identifier for the argument. It keys the parsed value, and it is what usage strings
   * and error messages call the argument, so it is never localized.
   */
  name: string
  /**
   * Whether the argument may be left out. Optional arguments can only follow required ones, and a
   * left-out one parses to `undefined`.
   */
  optional?: boolean
}

/** One token, with a leading `@` stripped, that has to look like a username. */
export interface UserArg extends BaseArg {
  kind: 'user'
}

/** One token, with a leading `#` stripped, that has to look like a channel name. */
export interface ChannelArg extends BaseArg {
  kind: 'channel'
}

/** One token, or a double-quoted run of tokens with the quotes stripped. */
export interface WordArg extends BaseArg {
  kind: 'word'
}

/**
 * Everything that is left, verbatim: spaces, quotes and slashes inside it all survive. Only the
 * last argument of a command (or of a subcommand option) can be one of these.
 */
export interface RestArg extends BaseArg {
  kind: 'rest'
}

/** One token that has to be one of `values`, matched without regard to case. */
export interface EnumArg extends BaseArg {
  kind: 'enum'
  /** The accepted values. The parsed value is always the one spelled as it is here. */
  values: readonly string[]
}

/**
 * One token spelling a length of time, such as `30s`, `1h30m` or `2d`. Units are `ms`, `s`, `m`,
 * `h`, `d` and `w`; they can be combined without spaces. The parsed value is in milliseconds.
 */
export interface DurationArg extends BaseArg {
  kind: 'duration'
}

/** One token spelling a number, optionally constrained to integers and/or to a range. */
export interface NumberArg extends BaseArg {
  kind: 'number'
  integer?: boolean
  min?: number
  max?: number
}

/** One of the shapes a subcommand argument can take. */
export interface SubcommandOption {
  /** The canonical English name, which is what the parsed value carries. */
  name: string
  aliases?: readonly string[]
  description: (t: TFunction) => string
  args: readonly CommandArg[]
}

/**
 * One token naming one of `options`, followed by that option's own arguments. Only the last
 * argument of a command can be one of these.
 */
export interface SubcommandArg extends BaseArg {
  kind: 'subcommand'
  options: readonly SubcommandOption[]
}

export type CommandArg =
  UserArg | ChannelArg | WordArg | RestArg | EnumArg | DurationArg | NumberArg | SubcommandArg

/** The value a parsed subcommand argument carries: which option was named, and its own arguments. */
export interface ParsedSubcommand<Name extends string = string, Args = ParsedArgValues> {
  name: Name
  args: Args
}

/** Parsed arguments with the schema that shaped them erased, as the parser hands them back. */
export interface ParsedArgValues {
  [name: string]: string | number | ParsedSubcommand | undefined
}

type SubcommandValues<Options extends readonly SubcommandOption[]> = {
  [K in keyof Options]: Options[K] extends SubcommandOption
    ? ParsedSubcommand<Options[K]['name'], ParsedArgs<Options[K]['args']>>
    : never
}[number]

type ArgValue<A extends CommandArg> = A extends { kind: 'number' | 'duration' }
  ? number
  : A extends { kind: 'subcommand'; options: infer Options }
    ? Options extends readonly SubcommandOption[]
      ? SubcommandValues<Options>
      : never
    : string

// An argument only comes back missing if it said it could be left out.
type MaybeMissing<A extends CommandArg> = A extends { optional: true }
  ? ArgValue<A> | undefined
  : ArgValue<A>

/** The arguments a command's schema produces, keyed by the names the schema gave them. */
export type ParsedArgs<Args extends readonly CommandArg[]> = {
  [Name in Args[number]['name']]: MaybeMissing<Extract<Args[number], { name: Name }>>
}

export interface CommandInvocation<Args = ParsedArgValues> {
  args: Args
  /**
   * The surface the command was run in. A command declared for a single surface still has to
   * narrow this before reaching into it.
   */
  context: CommandContext
  dispatch: DispatchFunction<ReduxAction>
  t: TFunction
  /** Puts a line only the running user sees into the surface the command was run in. */
  emit: LocalLineEmitter
  /**
   * Every command available in `context`, in display order. Handed in rather than looked up, so a
   * command that lists or resolves its siblings doesn't have to import the registry that holds it.
   */
  availableCommands: ReadonlyArray<ChatCommand>
}

/** A command as the registry holds it and the runner runs it, with its argument schema erased. */
export interface ChatCommand {
  /** The canonical name, lower-case and without a leading slash. Never localized. */
  name: string
  /** Other lower-case names that reach this command. Never localized. */
  aliases?: readonly string[]
  description: (t: TFunction) => string
  /** The surfaces the command can run in. Anywhere else it doesn't exist at all. */
  surfaces: readonly CommandSurface[]
  /**
   * Decides whether the command exists for a particular context, on top of `surfaces`. A command
   * that is unavailable is indistinguishable from one that doesn't exist: it is left out of help,
   * and naming it produces the unknown-command error.
   */
  isAvailable?: (context: CommandContext) => boolean
  args: readonly CommandArg[]
  // Declared as a method so that a command written against a precise argument schema is still one
  // of these, which is all the registry and the runner ever need it to be.
  run(invocation: CommandInvocation): void
}

/** A command as it is written: each argument carries the type its schema entry describes. */
export interface TypedChatCommand<Args extends readonly CommandArg[]> extends Omit<
  ChatCommand,
  'args' | 'run'
> {
  args: Args
  run(invocation: CommandInvocation<ParsedArgs<Args>>): void
}

/**
 * Declares a command, inferring its argument schema literally so that `run` sees each argument
 * under the name and with the type the schema gives it.
 */
export function defineCommand<const Args extends readonly CommandArg[]>(
  command: TypedChatCommand<Args>,
): ChatCommand {
  return command
}

/** Whether `name` reaches `command`, comparing without regard to case. */
export function matchesCommandName(command: ChatCommand, name: string): boolean {
  const lowered = name.toLowerCase()
  return (
    command.name.toLowerCase() === lowered ||
    (command.aliases?.some(alias => alias.toLowerCase() === lowered) ?? false)
  )
}

/** What usage strings and error messages call an argument. */
function getArgLabel(arg: CommandArg): string {
  switch (arg.kind) {
    case 'enum':
      return arg.values.join('|')
    case 'subcommand':
      return arg.options.map(option => option.name).join('|')
    default:
      return arg.name
  }
}

function getArgUsage(arg: CommandArg): string {
  return arg.optional ? `[${getArgLabel(arg)}]` : `<${getArgLabel(arg)}>`
}

/** Spells out how a command is typed, e.g. `/kick <user> [reason]`. */
export function getCommandUsage(command: ChatCommand): string {
  return [`/${command.name}`, ...command.args.map(getArgUsage)].join(' ')
}

/** Lists a command's aliases as they'd be typed, e.g. `/j, /channel`. Empty when it has none. */
export function formatAliases(command: ChatCommand): string {
  return (command.aliases ?? []).map(alias => `/${alias}`).join(', ')
}
