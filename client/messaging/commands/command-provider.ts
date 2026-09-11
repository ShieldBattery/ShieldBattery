import { TFunction } from 'i18next'
import { RootState } from '../../root-reducer'
import {
  MAX_TYPEAHEAD_ROWS,
  TypeaheadMatch,
  TypeaheadProvider,
  TypeaheadSuggestion,
} from '../typeahead'
import { CommandContext } from './command-context'
import { ArgCaret, locateArgAtCaret } from './command-parser'
import { ALL_COMMANDS } from './command-registry'
import {
  ChatCommand,
  getCommandUsage,
  getRunnableCommands,
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
   * The name is complete and names one of the given commands; the caret is in its arguments.
   * `argStart` is the message index the argument text starts at.
   */
  | { kind: 'args'; command: ChatCommand; argStart: number; caret: ArgCaret }
  /** The name is complete (whitespace follows it) but no given command answers to it. */
  | { kind: 'unknown' }

/**
 * Where in a command the caret at the end of `textBeforeCaret` sits, among the commands that can
 * be completed here. Leading whitespace is allowed, as when submitting.
 */
export function locateCommandCaret(
  textBeforeCaret: string,
  commands: ReadonlyArray<ChatCommand>,
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

  const command = commands.find(c => matchesCommandName(c, typed.slice(1, nameEnd)))
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
      const caret = locateCommandCaret(textBeforeCaret, commands)
      if (caret.kind !== 'name') {
        return undefined
      }

      const suggestions = matchCommands(commands, deps.context, caret.query, deps.t)
        .slice(0, MAX_TYPEAHEAD_ROWS)
        .map((command): TypeaheadSuggestion => ({
          key: `command:${command.name}`,
          text: getCommandUsage(command),
          visual: {
            kind: 'command',
            command,
            description: command.description(deps.t),
          },
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
      const runnable = getRunnableCommands(commands, deps.context, deps.t)
      const caret = locateCommandCaret(textBeforeCaret, runnable)
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
