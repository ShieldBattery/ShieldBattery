import { useStore } from 'jotai'
import { useRef, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { MatchmakingServiceErrorCode } from '../../common/matchmaking'
import { JotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { acceptMatch } from './action-creators'
import {
  acceptRequestGenerationAtom,
  clearMatchmakingState,
  foundMatchAtom,
  foundMatchGenerationAtom,
} from './matchmaking-atoms'

/** How many times to retry an accept request that fails for a transient reason. */
const MAX_ACCEPT_RETRIES = 10
/**
 * How long to wait before retrying a failed accept request. Short enough that the whole retry budget
 * still fits comfortably inside the accept window, long enough that a struggling server isn't being
 * hammered.
 */
const ACCEPT_RETRY_DELAY_MS = 400
/** How long an accept request is given to complete before it's abandoned and retried. */
const ACCEPT_REQUEST_TIMEOUT_MS = 3000

export interface UseAcceptMatchResult {
  /** Whether an accept request is currently in flight, including the backoff between retries. */
  acceptInProgress: boolean
  /** Sends the accept request, automatically retrying on transient failures. */
  triggerAccept: () => void
}

/**
 * Returns whether the found match an accept request was sent for is still the one this client is
 * accepting. The generation changes whenever the found match is set or cleared, so an unchanged
 * generation means nothing has replaced the match the request was for.
 */
function isAcceptTargetCurrent(store: JotaiStore, generation: number): boolean {
  return !!store.get(foundMatchAtom) && store.get(foundMatchGenerationAtom) === generation
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

  const sendAccept = (generation: number) => {
    logger.debug('Accepting match...')
    setAcceptInProgress(true)
    dispatch(
      acceptMatch({
        signal: AbortSignal.timeout(ACCEPT_REQUEST_TIMEOUT_MS),
        callbackOnAbort: true,
        onSuccess: () => {
          logger.debug(`Accepted match successfully`)
          setAcceptInProgress(false)
        },
        onError: err => {
          if (isFetchError(err) && err.code === MatchmakingServiceErrorCode.NoActiveMatch) {
            logger.error('Accepting match failed, no active match: ' + getErrorStack(err))
            setAcceptInProgress(false)
            // A match can dissolve while an accept for it is in flight (e.g. another player left
            // during the accept window), and this client can be requeued and matched again before
            // the response lands. Only tear down state that belongs to the match this request was
            // sent for, and only its own state: a requeue keeps the client in the queue, so wiping
            // everything would drop the UI out of a queue the server still has it in.
            if (isAcceptTargetCurrent(store, generation)) {
              clearMatchmakingState(store)
              onNoActiveMatch?.()
            }
          } else {
            logger.error(`Accepting match failed: ${getErrorStack(err)}`)
            // The accept stays in progress across the backoff, so pressing the button again can't
            // start a second retry chain overlapping this one.
            setTimeout(() => {
              // The match this chain belongs to can dissolve while a retry is pending and a
              // different one can be found in its place. Accepting then would ready this client up
              // for a match they never saw, so the chain only continues while its own match is
              // still the one being accepted.
              if (
                retries.current < MAX_ACCEPT_RETRIES &&
                isAcceptTargetCurrent(store, generation)
              ) {
                retries.current++
                logger.debug(`Retrying accept match...`)
                sendAccept(generation)
              } else {
                setAcceptInProgress(false)
              }
            }, ACCEPT_RETRY_DELAY_MS)
          }
        },
      }),
    )
  }

  const triggerAccept = () => {
    // This hook can outlive a single match (the matchmaking widget stays mounted across a requeue),
    // so the retry budget applies per user-initiated accept rather than per hook lifetime.
    retries.current = 0
    const generation = store.get(foundMatchGenerationAtom)
    store.set(acceptRequestGenerationAtom, generation)
    sendAccept(generation)
  }

  return { acceptInProgress, triggerAccept }
}
