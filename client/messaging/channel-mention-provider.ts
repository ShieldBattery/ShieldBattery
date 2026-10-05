import { ReadonlyDeep } from 'type-fest'
import { SbChannelId } from '../../common/chat'
import { CHANNEL_PATTERN } from '../../common/constants'
import { ChatState } from '../chat/chat-reducer'
import { rankByQuery } from './rank-by-query'
import {
  MAX_TYPEAHEAD_ROWS,
  TypeaheadMatch,
  TypeaheadProvider,
  TypeaheadSuggestion,
} from './typeahead'

/** A channel the mention palette can complete a typed `#name` to. */
export interface MentionableChannel {
  id: SbChannelId
  name: string
}

/** The start of a partially-typed `#name` immediately before the caret. */
const CHANNEL_MENTION_START_REGEX = /(?<=^|\s)#\S*$/

/**
 * The channels the user has joined, in the order they were joined (the order the sidebar lists
 * them in).
 */
export function getMentionableChannels(
  chat: ReadonlyDeep<Pick<ChatState, 'joinedChannels' | 'idToBasicInfo'>>,
): MentionableChannel[] {
  const channels: MentionableChannel[] = []
  for (const channelId of chat.joinedChannels) {
    const info = chat.idToBasicInfo.get(channelId)
    if (info) {
      channels.push({ id: info.id, name: info.name })
    }
  }

  return channels
}

/**
 * Completes `#name` channel mentions to the channels `getChannels` returns, which is read on every
 * match so the palette follows the user joining and leaving channels. A bare `#` offers them in the
 * order given; anything typed after it narrows them, best match first (see `rankByQuery`).
 */
export function createChannelMentionProvider(
  getChannels: () => ReadonlyArray<MentionableChannel>,
): TypeaheadProvider {
  return {
    id: 'channelMention',

    match(textBeforeCaret: string): TypeaheadMatch | undefined {
      const start = textBeforeCaret.search(CHANNEL_MENTION_START_REGEX)
      if (start === -1) {
        return undefined
      }

      const matchedText = textBeforeCaret.slice(start)
      const query = matchedText.slice(1)
      if (query.length > 0 && !CHANNEL_PATTERN.test(query)) {
        // The `#` is followed by something that could never be a channel name, so there is nothing
        // to complete.
        return undefined
      }

      const matched = rankByQuery(getChannels(), c => [c.name], query)

      return {
        start,
        matchedText,
        suggestions: matched.slice(0, MAX_TYPEAHEAD_ROWS).map(toSuggestion),
      }
    },
  }
}

function toSuggestion(channel: MentionableChannel): TypeaheadSuggestion {
  return {
    key: String(channel.id),
    text: channel.name,
    visual: { kind: 'channel', channelId: channel.id },
    insertText: `#${channel.name} `,
    exact: false,
  }
}
