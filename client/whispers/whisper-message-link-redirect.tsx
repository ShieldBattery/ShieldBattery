import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { WhisperServiceErrorCode } from '../../common/whispers'
import { isMessageLinkId } from '../messaging/message-link'
import { replace } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { resolveWhisperMessageLink } from './action-creators'
import { urlForWhisperMessage } from './whisper-url'

/**
 * Resolves a viewer-independent whisper message link (`/whispers/m/<id>`) to the conversation it
 * belongs to, from the current user's side, and redirects there. A `replace` rather than a `push`
 * is used throughout: the unresolved link is a waypoint, not a page worth keeping in history.
 */
export function WhisperMessageLinkRedirect({ messageId }: { messageId: string }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const onResolve = useEffectEvent((id: string, signal: AbortSignal) => {
    dispatch(
      resolveWhisperMessageLink(id, {
        signal,
        onSuccess: ({ targetId, users }) => {
          const targetName = users.find(u => u.id === targetId)?.name ?? ''
          replace(urlForWhisperMessage(targetId, targetName, id))
        },
        onError: err => {
          if (isFetchError(err) && err.code === WhisperServiceErrorCode.MessageNotFound) {
            snackbarController.showSnackbar(
              t(
                'whispers.errors.messageNotFound',
                "That message couldn't be found. It may have been deleted.",
              ),
              DURATION_LONG,
            )
          } else {
            snackbarController.showSnackbar(
              t('whispers.errors.resolveMessageLink', {
                defaultValue: 'Error opening message link: {{errorMessage}}',
                errorMessage: err.message,
              }),
              DURATION_LONG,
            )
          }

          replace('/')
        },
      }),
    )
  })

  useEffect(() => {
    if (!isMessageLinkId(messageId)) {
      replace('/')
      return undefined
    }

    const abortController = new AbortController()
    onResolve(messageId, abortController.signal)

    return () => {
      abortController.abort()
    }
  }, [messageId])

  return <LoadingDotsArea />
}
