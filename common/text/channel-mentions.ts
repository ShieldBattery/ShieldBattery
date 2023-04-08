import { CHANNEL_ALLOWED_CHARACTERS } from '../constants'
import { TypedGroupRegExpMatchArray } from '../regex'

const MENTION_PREFIX = String.raw`(?<prefix>\s|^)`
const MENTION_POSTFIX = String.raw`(?=\s|$)`

/**
 * Regex for detecting and parsing channel mentions. Channel mentions are a piece of text that start
 * with the # sign, followed up by the channel name. No punctuation is allowed after the channel
 * name (only whitespace and end-of-string), since most of them are allowed in channel name as well.
 *
 * The matched channel's name is available in the "channelName" capture group. There's also one
 * additional named capture group, namely "prefix", that contains all the matched characters before
 * the channel name.
 */
export const CHANNEL_MENTION_REGEX = new RegExp(
  String.raw`${MENTION_PREFIX}#(?<channelName>${CHANNEL_ALLOWED_CHARACTERS})${MENTION_POSTFIX}`,
  'gi',
)

export interface ChannelMentionGroups {
  prefix: string
  channelName: string
}

export interface ChannelMentionMatch {
  type: 'channelMention'
  text: string
  index: number
  groups: ChannelMentionGroups
}

/**
 * Matches all channel mentions in a given text. The channel is considered mentioned if the text
 * contains its name, preceded by the # sign. Note that this function only matches things that fit
 * the mentions pattern, it doesn't also verify that the mentioned channels actually exist in the
 * system.
 *
 * @returns A generator of matches for channel mentions, where each match includes a named capture
 *   group called "channelName" which contains just the matched name of the channel.
 */
export function* matchChannelMentions(text: string): Generator<ChannelMentionMatch> {
  const matches: IterableIterator<TypedGroupRegExpMatchArray<keyof ChannelMentionGroups>> =
    text.matchAll(CHANNEL_MENTION_REGEX) as IterableIterator<any>

  for (const match of matches) {
    yield {
      type: 'channelMention',
      text: match[0],
      index: match.index!,
      groups: match.groups,
    }
  }
}

/**
 * Regex for detecting an already parsed channel mention. When a channel mention is parsed, it is
 * saved with a custom markup syntax in the database. This regex parses the markup and extracts
 * channel IDs to a "channelId" capture group.
 */
export const CHANNEL_MENTION_MARKUP_REGEX = new RegExp(
  String.raw`${MENTION_PREFIX}<#(?<channelId>\d+)>${MENTION_POSTFIX}`,
  'gi',
)

export interface ChannelMentionMarkupGroups {
  prefix: string
  channelId: string
}

export interface ChannelMentionMarkupMatch {
  type: 'channelMentionMarkup'
  text: string
  index: number
  groups: ChannelMentionMarkupGroups
}

/**
 * Matches all channel mention markups in a given text. The channel mention markup contains the
 * channel ID, which can then be used to get the full channel's info.
 *
 * @returns A generator of matches for channel mention markups, where each match includes a named
 *   capture group called "channelId" which contains just the matched channel ID of the channel.
 */
export function* matchChannelMentionsMarkup(text: string): Generator<ChannelMentionMarkupMatch> {
  const matches: IterableIterator<TypedGroupRegExpMatchArray<keyof ChannelMentionMarkupGroups>> =
    text.matchAll(CHANNEL_MENTION_MARKUP_REGEX) as IterableIterator<any>

  for (const match of matches) {
    yield {
      type: 'channelMentionMarkup',
      text: match[0],
      index: match.index!,
      groups: match.groups,
    }
  }
}
