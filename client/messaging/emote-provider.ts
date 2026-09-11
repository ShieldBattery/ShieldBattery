import logger from '../logging/logger'
import { getUnicodeEmojiEntries } from './emoji-data'
import {
  EMOTE_QUERY_REGEX,
  orderEmoteSuggestions,
  recordEmoteUsage,
  searchUnicodeEmojis,
} from './emote-suggestions'
import { TypeaheadMatch, TypeaheadProvider, TypeaheadSuggestion } from './typeahead'

/**
 * Completes a partially-typed `:emoteQuery` with unicode emoji. The emoji dataset is loaded
 * lazily, so the rows arrive as a promise; a load that fails offers nothing rather than failing
 * the input.
 */
export const emoteProvider: TypeaheadProvider = {
  id: 'emote',

  match(textBeforeCaret: string): TypeaheadMatch | undefined {
    const emoteMatch = EMOTE_QUERY_REGEX.exec(textBeforeCaret)
    if (!emoteMatch) {
      return undefined
    }

    const query = emoteMatch.groups!.query
    const suggestions = getUnicodeEmojiEntries().then(
      entries =>
        orderEmoteSuggestions(searchUnicodeEmojis(entries, query)).map(
          (suggestion): TypeaheadSuggestion => ({
            key: suggestion.key,
            text: suggestion.name,
            visual: { kind: 'emoji', emoji: suggestion.emoji },
            insertText: suggestion.insertText,
            exact: false,
          }),
        ),
      (err: Error) => {
        logger.error(`Failed to load emoji data: ${String(err)}`)
        return []
      },
    )

    return { start: emoteMatch.index, matchedText: emoteMatch[0], suggestions }
  },

  onAccept(suggestion: TypeaheadSuggestion) {
    recordEmoteUsage(suggestion.key)
  },
}
