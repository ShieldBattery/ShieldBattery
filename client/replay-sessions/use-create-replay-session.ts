import { useTranslation } from 'react-i18next'
import { getErrorStack } from '../../common/errors'
import { ReplaySessionErrorCode } from '../../common/replay-sessions'
import { openSimpleDialog } from '../dialogs/action-creators'
import logger from '../logging/logger'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { createReplaySession, ReplaySessionSourceChoice } from './action-creators'
import { navigateToReplaySession } from './replay-session-url'

/**
 * Returns a function that opens a replay session for a replay and takes the user to its room, for
 * any surface that offers watching a replay with others.
 */
export function useCreateReplaySession(): (source: ReplaySessionSourceChoice) => void {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  return source => {
    dispatch(
      createReplaySession(source, {
        onSuccess: session => navigateToReplaySession(session.id),
        onError: err => {
          logger.error(`Error creating replay session: ${getErrorStack(err)}`)
          const code = isFetchError(err) ? err.code : undefined
          dispatch(
            openSimpleDialog(
              t('replaySessions.create.errorTitle', "Couldn't start watching with others"),
              code === ReplaySessionErrorCode.AlreadyInSession
                ? t(
                    'replaySessions.create.alreadyInSession',
                    'You are already in a replay session. Leave it to start another.',
                  )
                : t(
                    'replaySessions.create.errorBody',
                    'There was a problem setting up the replay session. Please try again later.',
                  ),
            ),
          )
        },
      }),
    )
  }
}
