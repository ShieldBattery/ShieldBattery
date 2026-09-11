import UFuzzy from '@leeoniya/ufuzzy'
import { TFunction } from 'i18next'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { CommandContext } from './command-context'
import {
  ArgSuggestDeps,
  ArgSuggestion,
  ChatCommand,
  CommandArg,
  getSurfaceCommands,
} from './command-schema'

// Same options as the @-mention and emote matchers: the query's characters in order, anything
// between them, without regard to case. A UFuzzy instance holds no per-search state, so one
// instance serves every call.
const fuzzy = new UFuzzy({ intraIns: Infinity, intraChars: '.' })

/**
 * Orders `items` by how well any of their names answers `query`: exact matches, then prefix
 * matches, then fuzzy ones (the query's characters appear in order, anything between, like the
 * mention and emote matchers), each tier in the order given. Matching ignores case. An empty
 * query keeps every item in the order given. Items that match nothing are left out.
 */
export function rankByQuery<T>(
  items: ReadonlyArray<T>,
  getNames: (item: T) => ReadonlyArray<string>,
  query: string,
): T[] {
  if (query.length === 0) {
    return items.slice()
  }

  const lowered = query.toLowerCase()
  const exact: T[] = []
  const prefix: T[] = []
  // Everything that missed both tiers gets one more shot at matching fuzzily. Names are flattened
  // so a single fuzzy pass covers every item's names at once; rows come back in haystack order,
  // which is item order, so deduping by first occurrence keeps the items in the order given.
  const rest: T[] = []
  const restNames: string[] = []
  const restNameItem: number[] = []

  for (const item of items) {
    const names = getNames(item).map(name => name.toLowerCase())
    if (names.some(name => name === lowered)) {
      exact.push(item)
    } else if (names.some(name => name.startsWith(lowered))) {
      prefix.push(item)
    } else {
      const itemIndex = rest.length
      rest.push(item)
      for (const name of names) {
        restNames.push(name)
        restNameItem.push(itemIndex)
      }
    }
  }

  const fuzzyMatches: T[] = []
  const seen = new Set<number>()
  for (const row of fuzzy.filter(restNames, lowered) ?? []) {
    const itemIndex = restNameItem[row]
    if (seen.has(itemIndex)) {
      continue
    }
    seen.add(itemIndex)
    fuzzyMatches.push(rest[itemIndex])
  }

  return exact.concat(prefix, fuzzyMatches)
}

export interface CommandMatch {
  command: ChatCommand
  /** Why the command can't be run in the context, when it can't. */
  unavailableReason: string | undefined
}

/**
 * The commands that exist in the context's surface and answer to `query` by name or alias, best
 * first. Commands that can't be run here are still listed, with their reason.
 */
export function matchCommands(
  commands: ReadonlyArray<ChatCommand>,
  context: CommandContext,
  query: string,
  t: TFunction,
): CommandMatch[] {
  const inSurface = getSurfaceCommands(commands, context.surface)
  const ranked = rankByQuery(
    inSurface,
    command => [command.name, ...(command.aliases ?? [])],
    query,
  )

  return ranked.map(command => ({
    command,
    unavailableReason: command.getUnavailableReason?.(context, t),
  }))
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
      // Only a channel knows who is in it; the other surfaces have nobody to offer.
      return deps.context.surface === 'channel'
        ? deps.context.members.map(member => ({
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
      return arg.options.map(option => ({ value: option.name }))

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

/** Narrows suggestions to those answering `query` (see rankByQuery over `value`). Uncapped. */
export function filterArgSuggestions(
  suggestions: ReadonlyArray<ArgSuggestion>,
  query: string,
): ArgSuggestion[] {
  return rankByQuery(suggestions, suggestion => [suggestion.value], query)
}
