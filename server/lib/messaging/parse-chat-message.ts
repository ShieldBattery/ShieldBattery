import { matchUserMentions, MENTION_REGEX } from '../../../common/text/mentions'
import { SbUser } from '../../../common/users/user-info'
import { findUsersByName } from '../users/user-model'

/**
 * Parses the chat message by extracting the user mentions in it and replacing them with a markup
 * that includes the user ID for each mention. The markup is in the format of `<@USER_ID>`, which
 * can then easily be used on the client to replace the markup with the appropriate UI.
 *
 * Any mention that doesn't map to a valid user in our system is left unreplaced.
 *
 * @returns A tuple of the parsed chat message, along with a map of userId -> user of each
 *   mentioned user.
 */
export async function parseChatMessage(text: string): Promise<[string, Map<string, SbUser>]> {
  const matches = Array.from(matchUserMentions(text))
  const mentionedUsers = await findUsersByName(matches.map(match => match.groups!.user))
  const usersLowercase = new Map(
    Array.from(mentionedUsers.entries()).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const parsedText = text.replaceAll(MENTION_REGEX, (_, prefix, user, postfix) => {
    const lowerCaseUser = user.toLowerCase()

    return usersLowercase.has(lowerCaseUser)
      ? `${prefix}<@${usersLowercase.get(lowerCaseUser)!.id}>${postfix}`
      : `${prefix}@${user}${postfix}`
  })

  return [parsedText, mentionedUsers]
}
