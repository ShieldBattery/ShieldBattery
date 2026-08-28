import { useStore } from 'jotai'
import { useRef, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { MatchmakingServiceErrorCode } from '../../common/matchmaking'
import logger from '../logging/logger'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { acceptMatch } from './action-creators'
import { clearMatchmakingState, foundMatchAtom } from './matchmaking-atoms'

/** How many times to retry an accept request that fails for a transient reason. */
const MAX_ACCEPT_RETRIES = 10
/**
 * How long to wait before retrying a failed accept request. Gives the button time to visibly
 * re-enable, since the user almost certainly wants to retry and may not have much time to react to
 * an error before the accept window closes.
 */
const ACCEPT_RETRY_DELAY_MS = 400

export interface UseAcceptMatchResult {
  /** Whether an accept request is currently in flight (including its retry backoff window). */
  acceptInProgress: boolean
  /** Sends the accept request, automatically retrying on transient failures. */
  triggerAccept: () => void
}

/**
 * Shared "Ready up" behavior for accepting a found match: sends the accept request, retrying
 * transient failures up to `MAX_ACCEPT_RETRIES` times. Used by both the accept-match dialog and
 * the matchmaking widget, so a match can be accepted regardless of whether the dialog has been
 * dismissed.
 *
 * If the server reports there's no longer an active match to accept, matchmaking state is cleared
 * and `onNoActiveMatch` is called (e.g. so the dialog can close itself).
 */
export function useAcceptMatch(onNoActiveMatch?: () => void): UseAcceptMatchResult {
  const dispatch = useAppDispatch()
  const store = useStore()
  const retries = useRef(0)
  const [acceptInProgress, setAcceptInProgress] = useState(false)

  const triggerAccept = () => {
    logger.debug('Accepting match...')
    setAcceptInProgress(true)
    dispatch(
      acceptMatch({
        signal: AbortSignal.timeout(3000),
        callbackOnAbort: true,
        onSuccess: () => {
          logger.debug(`Accepted match successfully`)
          setAcceptInProgress(false)
        },
        onError: err => {
          if (isFetchError(err) && err.code === MatchmakingServiceErrorCode.NoActiveMatch) {
            logger.error('Accepting match failed, no active match: ' + getErrorStack(err))
            clearMatchmakingState(store)
            onNoActiveMatch?.()
          } else {
            logger.error(`Accepting match failed: ${getErrorStack(err)}`)
            setAcceptInProgress(false)
            setTimeout(() => {
              // The match can dissolve (e.g. a requeue) while this retry is pending; accepting
              // then would get a NoActiveMatch response and wrongly clear the re-entered queue
              // state, so only retry while the match is still active.
              if (retries.current < MAX_ACCEPT_RETRIES && store.get(foundMatchAtom)) {
                retries.current++
                logger.debug(`Retrying accept match...`)
                triggerAccept()
              }
            }, ACCEPT_RETRY_DELAY_MS)
          }
        },
      }),
    )
  }

  return { acceptInProgress, triggerAccept }
}
