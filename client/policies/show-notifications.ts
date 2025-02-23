import { useEffect } from 'react'
import { useIsLoggedIn } from '../auth/auth-utils'
import { useAppDispatch } from '../redux-hooks'
import {
  addAcceptableUseNotificationIfNeeded,
  addPrivacyPolicyNotificationIfNeeded,
  addTermsOfServiceNotificationIfNeeded,
} from './action-creators'

export function useShowPolicyNotificationsIfNeeded() {
  const dispatch = useAppDispatch()
  const isLoggedIn = useIsLoggedIn()

  useEffect(() => {
    if (isLoggedIn) {
      dispatch(addPrivacyPolicyNotificationIfNeeded())
      dispatch(addTermsOfServiceNotificationIfNeeded())
      dispatch(addAcceptableUseNotificationIfNeeded())
    }
  }, [dispatch, isLoggedIn])
}
