import { getErrorStack } from '../../common/errors'
import { NotificationType, RulesUpdatedNotification } from '../../common/notifications'
import { RULES_VERSION } from '../../common/policies/versions'
import { apiUrl } from '../../common/urls'
import { AcceptRulesRequest, AcceptRulesResponse } from '../../common/users/user-network'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { fetchJson } from '../network/fetch'
import { addLocalNotification } from '../notifications/action-creators'

/**
 * Notifies the user, once, that the platform rules changed since the last version they were shown,
 * and records that they have now been shown the current version.
 */
export function addRulesNotificationIfNeeded(): ThunkAction {
  return (dispatch, getState) => {
    const {
      auth: { self },
    } = getState()

    const { id, acceptedRulesVersion } = self!.user

    // A cached self user can lack the version entirely, which says nothing about whether the user
    // was already notified, so only a known version that is behind triggers the notification.
    if (acceptedRulesVersion === undefined || acceptedRulesVersion >= RULES_VERSION) {
      return
    }

    dispatch(
      addLocalNotification<RulesUpdatedNotification>({
        type: NotificationType.RulesUpdated,
        id: 'local-rules',
      }),
    )

    const body: AcceptRulesRequest = { version: RULES_VERSION }
    const promise = fetchJson<AcceptRulesResponse>(apiUrl`users/${id}/rules`, {
      method: 'post',
      body: JSON.stringify(body),
    })
    dispatch({ type: '@auth/acceptRules', payload: promise })
    promise.catch(err => {
      logger.error('error while updating rules acceptance: ' + getErrorStack(err))
    })
  }
}
