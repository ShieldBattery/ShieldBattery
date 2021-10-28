import { matchUserMentions, MENTION_REGEX } from '../../../common/text/mentions'
import { SbUser } from '../../../common/users/user-info'
import { findUsersByName } from '../users/user-model'

/**
 * Processes the chat message by extracting the user mentions in it and replacing them with a markup
 * that includes the user ID for each mention. The markup is in the format of `<@USER_ID>`, which
 * can then easily be used on the client to replace the markup with the appropriate UI.
 *
 * Any mention that doesn't map to a valid user in our system is left unreplaced.
 *
 * @returns A tuple of the processed chat message, along with a map of userId -> user of each
 *   mentioned user.
 */
export async function processMessageContents(
  text: string,
  allowedMentionUsers: Set<string>,
): Promise<[processedText: string, mentions: Map<string, SbUser>]> {
  const mentionedUsernames = Array.from(
    matchUserMentions(text),
    match => match.groups.username,
  ).filter(username => allowedMentionUsers.has(username.toLowerCase()))
  const mentionedUsers = await findUsersByName(mentionedUsernames)
  const usernamesLowercase = new Map(
    Array.from(mentionedUsers.entries(), ([k, v]) => [k.toLowerCase(), v]),
  )
  const processedText = text.replaceAll(MENTION_REGEX, (_, prefix, username, postfix) => {
    const lowerCaseUser = username.toLowerCase()

    return usernamesLowercase.has(lowerCaseUser)
      ? `${prefix}<@${usernamesLowercase.get(lowerCaseUser)!.id}>${postfix}`
      : `${prefix}@${username}${postfix}`
  })

  return [processedText, mentionedUsers]
}
