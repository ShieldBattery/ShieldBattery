import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { openDialog } from '../../../dialogs/action-creators'
import { DialogType } from '../../../dialogs/dialog-type'
import { TransInterpolation } from '../../../i18n/i18next'
import { ChannelCommandContext } from '../command-context'
import { defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'

type MemberLookup =
  | { kind: 'found'; userId: SbUserId }
  /** Nobody in the channel goes by that name. */
  | { kind: 'none' }
  /** Several members go by that name, so there's nothing to pick between them on. */
  | { kind: 'ambiguous' }
  /** The name belongs to the user who typed the command. */
  | { kind: 'self' }

/**
 * Resolves a typed name to a member of the channel. Names are matched exactly (ignoring case)
 * rather than by prefix: a moderation action lands on whoever is named, so a near miss has to
 * fail rather than reach the wrong person.
 */
function findMember(context: ChannelCommandContext, typedName: string): MemberLookup {
  const lowered = typedName.toLowerCase()
  const matches = context.members.filter(member => member.name.toLowerCase() === lowered)

  if (matches.length === 0) {
    return { kind: 'none' }
  } else if (matches.length > 1) {
    return { kind: 'ambiguous' }
  } else if (matches[0].id === context.selfUserId) {
    return { kind: 'self' }
  }

  return { kind: 'found', userId: matches[0].id }
}

function noSuchMemberLine(name: string, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.errors.noSuchMember'>
      No one named <LocalStrong>{{ name } as TransInterpolation}</LocalStrong> is in this channel.
    </Trans>
  )
}

function ambiguousMemberLine(name: string, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.errors.ambiguousMember'>
      More than one member matches <LocalStrong>{{ name } as TransInterpolation}</LocalStrong>.
    </Trans>
  )
}

export const kickCommand = defineCommand({
  name: 'kick',
  description: t => t('chat.commands.kick.description', 'Kicks a user out of this channel.'),
  surfaces: ['channel'],
  getUnavailableReason: (context, t) =>
    context.surface === 'channel' && !context.canKick
      ? t(
          'chat.commands.kick.noPermission',
          "You don't have permission to kick users from this channel.",
        )
      : undefined,
  // The kick dialog collects no reason of its own, so one typed here is read and dropped. Both
  // moderation commands take the same shape so that neither needs to be retyped as the other.
  args: [
    { kind: 'user', name: 'user' },
    { kind: 'rest', name: 'reason', optional: true },
  ],

  run({ args, context, dispatch, t, emit }) {
    if (context.surface !== 'channel') {
      return
    }

    const found = findMember(context, args.user)
    switch (found.kind) {
      case 'none':
        emit({ kind: 'error', content: noSuchMemberLine(args.user, t) })
        return
      case 'ambiguous':
        emit({ kind: 'error', content: ambiguousMemberLine(args.user, t) })
        return
      case 'self':
        emit({
          kind: 'error',
          content: t('chat.commands.kick.noSelfKick', "You can't kick yourself."),
        })
        return
      case 'found':
        break
    }

    dispatch(
      openDialog({
        type: DialogType.ChannelKickUserConfirmation,
        initData: { channelId: context.channelId, userId: found.userId },
      }),
    )
  },
})

export const banCommand = defineCommand({
  name: 'ban',
  description: t => t('chat.commands.ban.description', 'Bans a user from this channel.'),
  surfaces: ['channel'],
  getUnavailableReason: (context, t) =>
    context.surface === 'channel' && !context.canBan
      ? t(
          'chat.commands.ban.noPermission',
          "You don't have permission to ban users from this channel.",
        )
      : undefined,
  args: [
    { kind: 'user', name: 'user' },
    { kind: 'rest', name: 'reason', optional: true },
  ],

  run({ args, context, dispatch, t, emit }) {
    if (context.surface !== 'channel') {
      return
    }

    const found = findMember(context, args.user)
    switch (found.kind) {
      case 'none':
        emit({ kind: 'error', content: noSuchMemberLine(args.user, t) })
        return
      case 'ambiguous':
        emit({ kind: 'error', content: ambiguousMemberLine(args.user, t) })
        return
      case 'self':
        emit({
          kind: 'error',
          content: t('chat.commands.ban.noSelfBan', "You can't ban yourself."),
        })
        return
      case 'found':
        break
    }

    // A typed reason fills the dialog's reason field in, which the user can still edit before the
    // ban goes through.
    dispatch(
      openDialog({
        type: DialogType.ChannelBanUser,
        initData: { channelId: context.channelId, userId: found.userId, banReason: args.reason },
      }),
    )
  },
})
