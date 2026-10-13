import { SbReplaySessionId } from '../../common/replay-sessions'
import { urlPath } from '../../common/urls'
import { push } from '../navigation/routing'

export function urlForReplaySession(sessionId: SbReplaySessionId) {
  return urlPath`/replay-sessions/${sessionId}`
}

export function navigateToReplaySession(sessionId: SbReplaySessionId, transitionFn = push) {
  transitionFn(urlForReplaySession(sessionId))
}
