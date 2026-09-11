import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { assertUnreachable } from '../../../../common/assert-unreachable'
import { ChatServiceErrorCode } from '../../../../common/chat'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { sendMessage as sendChannelMessage } from '../../../chat/action-creators'
import { TransInterpolation } from '../../../i18n/i18next'
import { sendChat as sendLobbyChat } from '../../../lobbies/action-creators'
import { RequestHandlingSpec } from '../../../network/abortable-thunk'
import { isFetchError } from '../../../network/fetch-errors'
import { sendMessage as sendWhisperMessage } from '../../../whispers/action-creators'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'

function sendFailedLine(err: Error, t: TFunction): React.ReactNode {
  const code = isFetchError(err) ? err.code : undefined

  // The channel and whisper services spell their chat-restriction code differently. The lobby
  // service's equivalent code lives only in server code, so a lobby restriction falls through to
  // the generic line below.
  if (
    code === ChatServiceErrorCode.UserChatRestricted ||
    code === WhisperServiceErrorCode.UserChatRestricted
  ) {
    return t(
      'chat.commands.me.chatRestricted',
      "You're currently restricted from sending chat messages.",
    )
  }

  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.me.sendError'>
      Couldn't send your emote: {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

export const meCommand = defineCommand({
  name: 'me',
  aliases: ['emote'],
  description: t =>
    t(
      'chat.commands.me.description',
      'Sends an action line, shown as "* YourName does something".',
    ),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'rest', name: 'action' }],

  run({ args, context, dispatch, t, emit }) {
    const spec: RequestHandlingSpec = {
      onSuccess: () => {},
      onError: err => emit({ kind: 'error', content: sendFailedLine(err, t) }),
    }

    switch (context.surface) {
      case 'channel':
        dispatch(sendChannelMessage(context.channelId, args.action, spec, { emote: true }))
        break
      case 'whisper':
        dispatch(sendWhisperMessage(context.targetId, args.action, spec, { emote: true }))
        break
      case 'lobby':
        dispatch(sendLobbyChat(args.action, spec, { emote: true }))
        break
      default:
        assertUnreachable(context)
    }
  },
})
