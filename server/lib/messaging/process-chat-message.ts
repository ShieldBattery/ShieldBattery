import { assertUnreachable } from '../../../common/assert-unreachable'
import { CHANNEL_MENTION_REGEX, matchChannelMentions } from '../../../common/text/channel-mentions'
import { USER_MENTION_REGEX, matchUserMentions } from '../../../common/text/user-mentions'
import { SbUser } from '../../../common/users/sb-user'
import { FullChannelInfo, findChannelsByName } from '../chat/chat-models'
import { findUsersByName } from '../users/user-model'

function* getAllMatches(text: string) {
  yield* matchUserMentions(text)
  yield* matchChannelMentions(text)
}

/**
 * Processes the chat message by extracting the user mentions and channel mentions in it and
 * replacing them with a markup that includes the user ID and channel ID for each mention,
 * respectively. The markup is in the format of `<@USER_ID>` or `<#CHANNEL_ID>`, which
 * can then easily be used on the client to replace the markup with the appropriate UI.
 *
 * Any mention that doesn't map to a valid user or channel in our system is left unreplaced.
 *
 * @returns A tuple of the processed chat message, along with a map of userId -> user of each
 *   mentioned user, and a map of channelId -> channel of each mentioned channel.
 */
export async function processMessageContents(
  text: string,
): Promise<[processedText: string, userMentions: SbUser[], channelMentions: FullChannelInfo[]]> {
  const matches = getAllMatches(text)
  const sortedMatches = Array.from(matches).sort((a, b) => a.index - b.index)
  const mentionedUsernames: string[] = []
  const mentionedChannelNames: string[] = []

  for (const match of sortedMatches) {
    if (match.type === 'userMention') {
      mentionedUsernames.push(match.groups.username)
    } else if (match.type === 'channelMention') {
      mentionedChannelNames.push(match.groups.channelName)
    } else {
      assertUnreachable(match)
    }
  }

  const [userMentions, channelMentions] = await Promise.all([
    findUsersByName(mentionedUsernames),
    findChannelsByName(mentionedChannelNames),
  ])

  const usernamesLowercase = new Map(userMentions.map(u => [u.name.toLowerCase(), u]))
  let processedText = text.replaceAll(USER_MENTION_REGEX, (_, prefix, username) => {
    const lowerCaseUser = username.toLowerCase()

    return usernamesLowercase.has(lowerCaseUser)
      ? `${prefix}<@${usernamesLowercase.get(lowerCaseUser)!.id}>`
      : `${prefix}@${username}`
  })

  const channelNamesLowercase = new Map(channelMentions.map(c => [c.name.toLowerCase(), c]))
  processedText = processedText.replaceAll(CHANNEL_MENTION_REGEX, (_, prefix, channelName) => {
    const lowerCaseChannel = channelName.toLowerCase()

    return channelNamesLowercase.has(lowerCaseChannel)
      ? `${prefix}<#${channelNamesLowercase.get(lowerCaseChannel)!.id}>`
      : `${prefix}#${channelName}`
  })

  return [processedText, userMentions, channelMentions]
}
