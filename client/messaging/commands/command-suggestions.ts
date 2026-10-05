import { TFunction } from 'i18next'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { rankByQuery } from '../rank-by-query'
import { CommandContext } from './command-context'
import {
  ArgSuggestDeps,
  ArgSuggestion,
  ChatCommand,
  CommandArg,
  getRunnableCommands,
} from './command-schema'

/** The commands that can be run here and answer to `query` by name or alias, best first. */
export function matchCommands(
  commands: ReadonlyArray<ChatCommand>,
  context: CommandContext,
  query: string,
  t: TFunction,
): ChatCommand[] {
  return rankByQuery(
    getRunnableCommands(commands, context, t),
    command => [command.name, ...(command.aliases ?? [])],
    query,
  )
}

/** Every value the palette could complete `arg` with: the argument's own `suggest`, or what its kind implies. */
export function getArgSuggestions(
  arg: CommandArg,
  deps: ArgSuggestDeps,
): ReadonlyArray<ArgSuggestion> {
  if (arg.suggest) {
    return arg.suggest(deps)
  }

  switch (arg.kind) {
    case 'user':
      // Only a channel knows who is in it; the other surfaces have nobody to offer. The user
      // running the command is never offered: the server refuses to moderate or whisper yourself,
      // so no command's user argument sensibly names the caller.
      return deps.context.surface === 'channel'
        ? deps.context.members
            .filter(member => member.id !== deps.context.selfUserId)
            .map(member => ({
              value: member.name,
              user: { id: member.id, online: member.online },
            }))
        : []

    case 'channel': {
      const { chat } = deps.getState()
      // The channels already joined are the likelier targets, so they come first.
      const joined: ArgSuggestion[] = []
      const known: ArgSuggestion[] = []
      for (const info of chat.idToBasicInfo.values()) {
        ;(chat.joinedChannels.has(info.id) ? joined : known).push({ value: info.name })
      }
      return joined.concat(known)
    }

    case 'enum':
      return arg.values.map(value => ({ value }))

    case 'subcommand':
      return arg.options.map(option => ({ value: option.name, aliases: option.aliases }))

    case 'word':
    case 'rest':
    case 'duration':
    case 'number':
      // Free-form values: nothing to complete from.
      return []

    default:
      return assertUnreachable(arg)
  }
}

/**
 * Whether the values `getArgSuggestions` offers for `arg` are the only ones it accepts. An `enum`
 * or a `subcommand` is exhaustive whatever it declares, since the parser refuses anything they
 * don't list.
 */
export function isExhaustiveArg(arg: CommandArg): boolean {
  return arg.kind === 'enum' || arg.kind === 'subcommand' || arg.exhaustive === true
}

/** Whether `query` spells the suggestion's value or one of its aliases out in full, in any case. */
export function spellsArgSuggestion(suggestion: ArgSuggestion, query: string): boolean {
  const lowered = query.toLowerCase()
  return (
    suggestion.value.toLowerCase() === lowered ||
    (suggestion.aliases?.some(alias => alias.toLowerCase() === lowered) ?? false)
  )
}

/**
 * Narrows suggestions to those answering `query` (see rankByQuery over `value` and `aliases`).
 * Uncapped.
 */
export function filterArgSuggestions(
  suggestions: ReadonlyArray<ArgSuggestion>,
  query: string,
): ArgSuggestion[] {
  return rankByQuery(
    suggestions,
    suggestion => [suggestion.value, ...(suggestion.aliases ?? [])],
    query,
  )
}
