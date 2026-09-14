import { SbUserId } from '../../../../common/users/sb-user-id'
import { findUserByName } from '../../../users/action-creators'
import { UserCard } from '../../../users/user-card'
import { userLookupFailedLine } from '../command-lines'
import {
  ALL_COMMAND_SURFACES,
  CommandArg,
  CommandInvocation,
  defineCommand,
} from '../command-schema'

/** What resolving a command's user argument needs from the invocation it happens in. */
type ResolveDeps = Pick<CommandInvocation, 'context' | 'dispatch' | 't' | 'emit'>

/**
 * Hands `onResolved` the user a command's optional user argument names: whoever ran the command when
 * no name was typed, otherwise the user carrying the typed name, looked up on the server if the
 * client hasn't seen them. A lookup that finds nobody (or fails) answers with a line of its own and
 * never calls back.
 */
export function resolveTarget(
  typedName: string | undefined,
  { context, dispatch, t, emit }: ResolveDeps,
  onResolved: (user: { id: SbUserId; name: string }) => void,
): void {
  if (typedName === undefined) {
    dispatch((_, getState) => {
      onResolved({
        id: context.selfUserId,
        name: getState().users.byId.get(context.selfUserId)?.name ?? '',
      })
    })
    return
  }

  dispatch(
    findUserByName(typedName, {
      onSuccess: user => onResolved(user),
      onError: err => emit({ kind: 'error', content: userLookupFailedLine(typedName, err, t) }),
    }),
  )
}

/**
 * Whose card to show. Any user on the server can be named, not just someone in the surface the
 * command was typed in, so the rows the palette offers are a shortcut rather than the whole set.
 */
const USER_ARG = { kind: 'user', name: 'user', optional: true } as const satisfies CommandArg

/** Answers with the card of the user the command named, or of whoever ran it. */
function showUserCard(invocation: CommandInvocation<{ user: string | undefined }>): void {
  resolveTarget(invocation.args.user, invocation, user => {
    invocation.emit({ kind: 'card', content: <UserCard userId={user.id} /> })
  })
}

export const profileCommand = defineCommand({
  name: 'profile',
  aliases: ['p'],
  description: t =>
    t(
      'chat.commands.profile.description',
      "Shows a user's profile card: their rank and win/loss record.",
    ),
  surfaces: ALL_COMMAND_SURFACES,
  args: [USER_ARG],

  run: showUserCard,
})

export const statsCommand = defineCommand({
  name: 'stats',
  aliases: ['astat'],
  description: t =>
    t('chat.commands.stats.description', "Shows a user's win/loss record and ranks."),
  surfaces: ALL_COMMAND_SURFACES,
  // Battle.net's `/stats <user> [product]` shape is accepted so that muscle memory works, but there
  // is only one product here, so the argument is read and dropped.
  args: [USER_ARG, { kind: 'word', name: 'product', optional: true }],

  run: showUserCard,
})

export const rankCommand = defineCommand({
  name: 'rank',
  aliases: ['mmr'],
  description: t => t('chat.commands.rank.description', "Shows a user's current ranked divisions."),
  surfaces: ALL_COMMAND_SURFACES,
  args: [USER_ARG],

  run: showUserCard,
})
