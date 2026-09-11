import { TFunction } from 'i18next'
import { RootState } from '../../root-reducer'
import {
  MAX_TYPEAHEAD_ROWS,
  TypeaheadMatch,
  TypeaheadProvider,
  TypeaheadSuggestion,
} from '../typeahead'
import { CommandContext, CommandSurface } from './command-context'
import { ArgCaret, locateArgAtCaret } from './command-parser'
import { ALL_COMMANDS } from './command-registry'
import {
  ChatCommand,
  CommandArgUsage,
  getCommandUsage,
  getSurfaceCommands,
  matchesCommandName,
} from './command-schema'
import { filterArgSuggestions, getArgSuggestions, matchCommands } from './command-suggestions'

export interface CommandProviderDeps {
  context: CommandContext
  getState: () => RootState
  t: TFunction
  /** Defaults to ALL_COMMANDS. */
  commands?: ReadonlyArray<ChatCommand>
}

export type CommandCaret =
  /** Not a command: no leading slash, or the `//` escape. */
  | { kind: 'none' }
  /**
   * The caret is in the command name. `start` is the index of the slash; `query` is what follows
   * it up to the caret.
   */
  | { kind: 'name'; start: number; query: string }
  /**
   * The name is complete and names a command that exists in this surface; the caret is in its
   * arguments. `argStart` is the message index the argument text starts at.
   */
  | { kind: 'args'; command: ChatCommand; argStart: number; caret: ArgCaret }
  /** The name is complete (whitespace follows it) but no command of this surface answers to it. */
  | { kind: 'unknown' }

/**
 * Where in a command the caret at the end of `textBeforeCaret` sits. Leading whitespace is
 * allowed, as when submitting.
 */
export function locateCommandCaret(
  textBeforeCaret: string,
  commands: ReadonlyArray<ChatCommand>,
  surface: CommandSurface,
): CommandCaret {
  const slashIndex = textBeforeCaret.length - textBeforeCaret.trimStart().length
  const typed = textBeforeCaret.slice(slashIndex)
  if (!typed.startsWith('/') || typed.startsWith('//')) {
    return { kind: 'none' }
  }

  const nameEnd = typed.search(/\s/)
  if (nameEnd === -1) {
    return { kind: 'name', start: slashIndex, query: typed.slice(1) }
  }

  // A command that exists in the surface but can't be run still has arguments worth completing:
  // typing it out is how the user finds out why it won't run.
  const command = getSurfaceCommands(commands, surface).find(c =>
    matchesCommandName(c, typed.slice(1, nameEnd)),
  )
  if (!command) {
    return { kind: 'unknown' }
  }

  const argStart = slashIndex + nameEnd
  return {
    kind: 'args',
    command,
    argStart,
    caret: locateArgAtCaret(command, textBeforeCaret.slice(argStart)),
  }
}

/** Completes the name of a command typed at the start of the input. */
export function createCommandNameProvider(deps: CommandProviderDeps): TypeaheadProvider {
  const commands = deps.commands ?? ALL_COMMANDS

  return {
    id: 'command',

    match(textBeforeCaret: string): TypeaheadMatch | undefined {
      const caret = locateCommandCaret(textBeforeCaret, commands, deps.context.surface)
      if (caret.kind !== 'name') {
        return undefined
      }

      const suggestions = matchCommands(commands, deps.context, caret.query, deps.t)
        .slice(0, MAX_TYPEAHEAD_ROWS)
        .map(({ command, unavailableReason }): TypeaheadSuggestion => ({
          key: `command:${command.name}`,
          text: getCommandUsage(command),
          secondaryText: unavailableReason ?? command.description(deps.t),
          visual: { kind: 'command', command, unavailable: unavailableReason !== undefined },
          insertText: `/${command.name} `,
          exact: matchesCommandName(command, caret.query),
        }))

      return {
        start: caret.start,
        matchedText: `/${caret.query}`,
        suggestions,
        submitOnExact: true,
        // A space right after the bare slash is only ever a space; a single row is worth accepting
        // once something has been typed towards it.
        spaceAcceptsSingle: caret.query.length > 0,
      }
    },
  }
}

/** Completes the argument of a command the caret sits in, for the arguments that offer values. */
export function createCommandArgProvider(deps: CommandProviderDeps): TypeaheadProvider {
  const commands = deps.commands ?? ALL_COMMANDS

  return {
    id: 'argument',

    match(textBeforeCaret: string): TypeaheadMatch | undefined {
      const caret = locateCommandCaret(textBeforeCaret, commands, deps.context.surface)
      if (caret.kind !== 'args') {
        return undefined
      }
      const { activeArg, token } = caret.caret
      if (!activeArg || !token) {
        return undefined
      }

      const base = getArgSuggestions(activeArg, { context: deps.context, getState: deps.getState })
      if (base.length === 0) {
        // An argument with nothing to complete leaves the caret to the mention and emote
        // providers, which is what makes `@name` and `:emote` work inside a `rest` argument.
        return undefined
      }

      // A typed sigil is kept rather than completed over, since the parser accepts it either way.
      const prefix =
        (activeArg.kind === 'user' && token.text.startsWith('@')) ||
        (activeArg.kind === 'channel' && token.text.startsWith('#'))
          ? token.text[0]
          : ''
      const query = token.text.slice(prefix.length)

      const suggestions = filterArgSuggestions(base, query)
        .slice(0, MAX_TYPEAHEAD_ROWS)
        .map((suggestion): TypeaheadSuggestion => ({
          key: `argument:${suggestion.value}`,
          text: suggestion.value,
          visual: suggestion.user
            ? { kind: 'user', userId: suggestion.user.id, online: suggestion.user.online }
            : { kind: 'plain' },
          insertText: `${prefix}${suggestion.value} `,
          exact: query.toLowerCase() === suggestion.value.toLowerCase(),
        }))

      return {
        start: caret.argStart + token.start,
        matchedText: token.text,
        suggestions,
        submitOnExact: true,
        // An argument nothing has been typed for yet is being skipped over, not completed, when
        // the user presses space; a single row is only worth accepting once it has been typed
        // towards.
        spaceAcceptsSingle: query.length > 0,
      }
    },
  }
}

/** What signature help shows: a command's usage with one part emphasized. */
export interface SignatureHelp {
  command: ChatCommand
  signature: CommandArgUsage[]
  /**
   * Which part is being typed: the name, an index into `signature`, or nothing (the caret is past
   * every argument).
   */
  active: 'name' | number | undefined
}

/**
 * Signature help for the caret, when it is in a known command's arguments. (The name case is built
 * by the input from the palette's highlighted row.)
 */
export function getSignatureHelpAtCaret(caret: CommandCaret): SignatureHelp | undefined {
  return caret.kind === 'args'
    ? { command: caret.command, signature: caret.caret.signature, active: caret.caret.activeIndex }
    : undefined
}
