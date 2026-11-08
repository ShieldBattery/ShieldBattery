import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { ChatServiceErrorCode } from '../../common/chat'
import { WhisperServiceErrorCode } from '../../common/whispers'
import { TransInterpolation } from '../i18n/i18next'
import { isFetchError } from '../network/fetch-errors'

/** The only-you line a plain chat message that failed to send is answered with. */
export function sendFailedLine(err: Error, t: TFunction): React.ReactNode {
  const code = isFetchError(err) ? err.code : undefined

  // The channel and whisper services spell their chat-restriction code differently. The lobby
  // service's equivalent code lives only in server code, so a lobby restriction falls through to
  // the generic line below.
  if (
    code === ChatServiceErrorCode.UserChatRestricted ||
    code === WhisperServiceErrorCode.UserChatRestricted
  ) {
    return t(
      'chat.sendFailed.chatRestricted',
      "You're currently restricted from sending chat messages.",
    )
  }

  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.sendFailed.error'>
      Your message was not sent: {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}
