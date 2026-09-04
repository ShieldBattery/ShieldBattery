import { useTranslation } from 'react-i18next'
import { WhisperServiceErrorCode } from '../../common/whispers'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { resolveWhisperMessageLink } from './action-creators'
import { urlForWhisperMessage } from './whisper-url'

/**
 * Returns a function that resolves a viewer-independent whisper message link (`/whispers/m/<id>`)
 * to the opener's own whisper URL and navigates there. This is the one place that turns such a
 * link into somewhere the current user can actually go, shared by the message-link chip (which
 * navigates on success and otherwise leaves the viewer wherever they were, with a snackbar) and the
 * `/whispers/m/<id>` redirect route (which has no "where they were" to fall back to, and so
 * navigates home on failure instead).
 */
export function useOpenWhisperMessageLink() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  return (
    messageId: string,
    options: { transitionFn?: typeof push; signal?: AbortSignal; onError?: () => void },
  ) => {
    dispatch(
      resolveWhisperMessageLink(messageId, {
        signal: options.signal,
        onSuccess: ({ targetId, users }) => {
          const targetName = users.find(u => u.id === targetId)?.name ?? ''
          const transition = options.transitionFn ?? push
          transition(urlForWhisperMessage(targetId, targetName, messageId))
        },
        onError: err => {
          if (isFetchError(err) && err.code === WhisperServiceErrorCode.MessageNotFound) {
            snackbarController.showSnackbar(
              t(
                'whispers.errors.messageLinkNotFound',
                "That message couldn't be opened. It isn't in one of your whispers.",
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

          options.onError?.()
        },
      }),
    )
  }
}
