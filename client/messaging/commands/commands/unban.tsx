import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { ChatServiceErrorCode } from '../../../../common/chat'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { unbanUser } from '../../../chat/action-creators'
import { TransInterpolation } from '../../../i18n/i18next'
import { isFetchError } from '../../../network/fetch-errors'
import { ConnectedUsername } from '../../../users/connected-username'
import { defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'
import { resolveTarget } from './user-card'

function noPermission(t: TFunction): string {
  return t(
    'chat.commands.unban.noPermission',
    "You don't have permission to unban users from this channel.",
  )
}

function unbannedLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.unban.unbanned'>
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      is no longer banned from this channel.
    </Trans>
  )
}

function unbanFailedLine(userId: SbUserId, err: Error, t: TFunction): React.ReactNode {
  const code = isFetchError(err) ? err.code : undefined

  if (code === ChatServiceErrorCode.TargetNotBanned) {
    return (
      <Trans t={t} i18nKey='chat.commands.unban.notBanned'>
        <LocalStrong>
          <ConnectedUsername userId={userId} />
        </LocalStrong>{' '}
        isn't banned from this channel.
      </Trans>
    )
  } else if (code === ChatServiceErrorCode.NotEnoughPermissions) {
    return noPermission(t)
  }

  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.unban.error'>
      Couldn't unban{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>
      : {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

export const unbanCommand = defineCommand({
  name: 'unban',
  description: t => t('chat.commands.unban.description', "Lifts a user's ban from this channel."),
  surfaces: ['channel'],
  getUnavailableReason: (context, t) =>
    context.surface === 'channel' && !context.canBan ? noPermission(t) : undefined,
  args: [
    // Whoever is banned from a channel is by definition not in it, so the members the palette would
    // otherwise offer are the one set of names this argument never wants.
    { kind: 'user', name: 'user', suggest: () => [] },
  ],

  run(invocation) {
    const { context, dispatch, t, emit } = invocation
    if (context.surface !== 'channel') {
      return
    }

    const channelId = context.channelId
    resolveTarget(invocation.args.user, invocation, target => {
      dispatch(
        unbanUser(channelId, target.id, {
          onSuccess: () => emit({ kind: 'info', content: unbannedLine(target.id, t) }),
          onError: err => emit({ kind: 'error', content: unbanFailedLine(target.id, err, t) }),
        }),
      )
    })
  },
})
