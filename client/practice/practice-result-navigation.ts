import { pushCurrentWithState } from '../navigation/routing'

export const PRACTICE_RESULT_OPEN_STATE = 'PRACTICE_RESULT:open'

/**
 * Shows the result screen for the latest practice session over whatever page is open. It lives in
 * a history entry of its own at the same URL, so closing it (or going back) returns to that page
 * with its state untouched.
 */
export function showPracticeResult(): void {
  if (history.state !== PRACTICE_RESULT_OPEN_STATE) {
    pushCurrentWithState(PRACTICE_RESULT_OPEN_STATE)
  }
}

export function closePracticeResult(): void {
  if (history.state === PRACTICE_RESULT_OPEN_STATE) {
    history.back()
  }
}
