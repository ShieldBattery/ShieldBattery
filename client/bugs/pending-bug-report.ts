import { useEffect, useRef } from 'react'
import { useRoute } from 'wouter'
import { redirectToLogin, useIsLoggedIn } from '../auth/auth-utils'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useAppDispatch } from '../redux-hooks'
import { JsonSessionStorageValue } from '../session-storage'

/**
 * Set when the user asks to report a bug from a place that can't show the bug report dialog itself
 * (e.g. the app having crashed), so the dialog can be shown once the app has reloaded. Kept in
 * session storage so it survives the reload but not the app being closed.
 */
const pendingBugReport = new JsonSessionStorageValue<boolean>('pendingBugReport')

/** Asks for the bug report dialog to be shown the next time the app loads. */
export function requestBugReportOnNextLoad() {
  pendingBugReport.setValue(true)
}

/**
 * Shows the bug report dialog if one was requested before the app last loaded. Reports are tied to
 * an account, so a logged out user is sent to log in first, and the dialog follows the login.
 */
export function useShowPendingBugReport() {
  const dispatch = useAppDispatch()
  const isLoggedIn = useIsLoggedIn()
  const [onLoginPage] = useRoute('/login')
  const sentToLogin = useRef(false)

  useEffect(() => {
    if (!IS_ELECTRON || !pendingBugReport.getValue()) {
      return
    }

    if (isLoggedIn) {
      pendingBugReport.clear()
      dispatch(openDialog({ type: DialogType.BugReport }))
    } else if (!onLoginPage && !sentToLogin.current) {
      sentToLogin.current = true
      redirectToLogin()
    }
  }, [dispatch, isLoggedIn, onLoginPage])
}
