import UFuzzy from '@leeoniya/ufuzzy'
import { matchUserMentions } from '../../common/text/user-mentions'
import { SbUserId } from '../../common/users/sb-user-id'
import {
  MAX_TYPEAHEAD_ROWS,
  TypeaheadMatch,
  TypeaheadProvider,
  TypeaheadSuggestion,
} from './typeahead'

/**
 * The number of users the mention palette offers, kept to what fits without scrolling: someone
 * typing a mention is usually after one particular person anyway.
 */
export const MAX_MENTIONED_USERS = MAX_TYPEAHEAD_ROWS

/** A user the mention palette can complete a typed `@name` to. */
export interface MentionableUser {
  id: SbUserId
  name: string
  online: boolean
}

// Chars in order, anything between, without regard to case. A UFuzzy instance holds no per-search
// state, so one instance serves every call.
const fuzzy = new UFuzzy({ intraIns: Infinity, intraChars: '.' })

/** The start of a partially-typed `@name` immediately before the caret. */
const MENTION_START_REGEX = /(?<=^|\s)@\S*$/

/**
 * Completes `@name` mentions. A bare `@` offers `baseMentionableUsers` (whoever is most worth
 * suggesting before anything has been typed, e.g. the channel's recent chatters); anything typed
 * after it narrows `mentionableUsers` fuzzily.
 */
export function createMentionProvider(
  mentionableUsers: ReadonlyArray<MentionableUser>,
  baseMentionableUsers?: ReadonlyArray<MentionableUser>,
): TypeaheadProvider {
  return {
    id: 'mention',

    match(textBeforeCaret: string): TypeaheadMatch | undefined {
      if (baseMentionableUsers?.length) {
        if (textBeforeCaret === '@' || textBeforeCaret.endsWith(' @')) {
          return {
            start: textBeforeCaret.length - 1,
            matchedText: '@',
            suggestions: baseMentionableUsers.map(toSuggestion),
          }
        }
      }

      const start = textBeforeCaret.search(MENTION_START_REGEX)
      if (start === -1) {
        return undefined
      }

      // There can only be one mention in a run of non-whitespace starting at an `@`.
      const [mention] = Array.from(matchUserMentions(textBeforeCaret.slice(start)))
      if (!mention) {
        // The `@` is followed by something that could never be a username, so there is nothing to
        // complete.
        return undefined
      }

      const matchedIndexes = fuzzy.filter(
        mentionableUsers.map(u => u.name),
        mention.groups.username,
      )
      const matched = matchedIndexes?.map(i => mentionableUsers[i]) ?? []

      return {
        start,
        matchedText: mention.text,
        suggestions: matched.slice(0, MAX_MENTIONED_USERS).map(toSuggestion),
      }
    },
  }
}

function toSuggestion(user: MentionableUser): TypeaheadSuggestion {
  return {
    key: String(user.id),
    text: user.name,
    visual: { kind: 'user', userId: user.id, online: user.online },
    insertText: `@${user.name} `,
    exact: false,
  }
}
