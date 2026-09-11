import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { WhisperServiceErrorCode } from '../../../../common/whispers'
import { TransInterpolation } from '../../../i18n/i18next'
import { isFetchError } from '../../../network/fetch-errors'
import {
  navigateToWhisper,
  sendMessage as sendWhisperMessage,
  startWhisperSessionByName,
} from '../../../whispers/action-creators'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'

function startFailedLine(target: string, err: Error, t: TFunction): React.ReactNode {
  const code = isFetchError(err) ? err.code : undefined

  if (code === WhisperServiceErrorCode.UserNotFound) {
    return (
      <Trans t={t} i18nKey='chat.commands.whisper.userNotFound'>
        No user named <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>.
      </Trans>
    )
  } else if (code === WhisperServiceErrorCode.NoSelfMessaging) {
    return t('chat.commands.whisper.noSelfMessaging', "You can't whisper yourself.")
  }

  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.whisper.startError'>
      Couldn't start a whisper with <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>:{' '}
      {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

function sendFailedLine(target: string, err: Error, t: TFunction): React.ReactNode {
  const errorMessage = err.message
  return (
    <Trans t={t} i18nKey='chat.commands.whisper.sendError'>
      Couldn't send the whisper to <LocalStrong>{{ target } as TransInterpolation}</LocalStrong>:{' '}
      {{ errorMessage } as TransInterpolation}
    </Trans>
  )
}

export const whisperCommand = defineCommand({
  name: 'whisper',
  aliases: ['w', 'm', 'msg', 'tell', 't'],
  description: t => t('chat.commands.whisper.description', 'Sends a private message to a user.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [
    { kind: 'user', name: 'user' },
    { kind: 'rest', name: 'message', optional: true },
  ],

  run({ args, dispatch, t, emit }) {
    const target = args.user
    const message = args.message

    dispatch(
      startWhisperSessionByName(target, {
        onSuccess: ({ userId }) => {
          if (message === undefined) {
            navigateToWhisper(userId, target)
            return
          }

          // The conversation only opens once the message has landed in it, so a send that fails
          // leaves the user where they were, with the error next to the input they typed it in.
          dispatch(
            sendWhisperMessage(userId, message, {
              onSuccess: () => navigateToWhisper(userId, target),
              onError: err => emit({ kind: 'error', content: sendFailedLine(target, err, t) }),
            }),
          )
        },
        onError: err => emit({ kind: 'error', content: startFailedLine(target, err, t) }),
      }),
    )
  },
})
