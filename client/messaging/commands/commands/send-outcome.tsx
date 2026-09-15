import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { assertUnreachable } from '../../../../common/assert-unreachable'
import { ChatServiceErrorCode } from '../../../../common/chat'
import { RolledOutcomeRequest } from '../../../../common/rolled-outcomes'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { sendOutcome as sendChannelOutcome } from '../../../chat/action-creators'
import { TransInterpolation } from '../../../i18n/i18next'
import { sendOutcome as sendLobbyOutcome } from '../../../lobbies/action-creators'
import { RequestHandlingSpec } from '../../../network/abortable-thunk'
import { isFetchError } from '../../../network/fetch-errors'
import { sendOutcome as sendWhisperOutcome } from '../../../whispers/action-creators'
import { CommandInvocation } from '../command-schema'

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
      'chat.commands.outcomes.chatRestricted',
      "You're currently restricted from sending chat messages.",
    )
  }

  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.outcomes.sendError'>
      Couldn't settle that: {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

/**
 * Asks the surface's server endpoint to settle an outcome and announce it. There is no success
 * line: the server-authored action line arriving in the surface is the feedback.
 */
export function sendOutcome(
  request: RolledOutcomeRequest,
  { context, dispatch, t, emit }: Pick<CommandInvocation, 'context' | 'dispatch' | 't' | 'emit'>,
): void {
  const spec: RequestHandlingSpec = {
    onSuccess: () => {},
    onError: err => emit({ kind: 'error', content: sendFailedLine(err, t) }),
  }

  switch (context.surface) {
    case 'channel':
      dispatch(sendChannelOutcome(context.channelId, request, spec))
      break
    case 'whisper':
      dispatch(sendWhisperOutcome(context.targetId, request, spec))
      break
    case 'lobby':
      dispatch(sendLobbyOutcome(request, spec))
      break
    default:
      assertUnreachable(context)
  }
}
