import { NotificationType, PolicyUpdatedNotification } from '../../common/notifications'
import { SbPolicyType } from '../../common/policies/policy-type'
import {
  ACCEPTABLE_USE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from '../../common/policies/versions'
import { apiUrl } from '../../common/urls'
import { AcceptPoliciesBody, AcceptPoliciesPayload, SbUserId } from '../../common/users/user-info'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { fetchJson } from '../network/fetch'
import { addLocalNotification } from '../notifications/action-creators'

const policyBatchRequester = new MicrotaskBatchRequester<
  [userId: SbUserId, policyType: SbPolicyType, version: number]
>(
  100,
  (dispatch, items) => {
    const body: AcceptPoliciesBody = {
      policies: items.map(([_, policyType, version]) => [policyType, version]),
    }
    const userId = items[0][0]
    const promise = fetchJson<AcceptPoliciesPayload>(apiUrl`users/${userId}/policies`, {
      method: 'post',
      body: JSON.stringify(body),
    })

    dispatch({ type: '@auth/acceptPolicies', payload: promise, meta: {} })

    return promise
  },
  err => {
    logger.error('error while updating policy acceptance: ' + (err as Error)?.stack ?? err)
  },
)

export function addPrivacyPolicyNotificationIfNeeded(): ThunkAction {
  return (dispatch, getState) => {
    const {
      auth: {
        user: { id, acceptedPrivacyVersion },
      },
    } = getState()

    if (acceptedPrivacyVersion < PRIVACY_POLICY_VERSION) {
      dispatch(
        addLocalNotification<PolicyUpdatedNotification>({
          type: NotificationType.PolicyUpdated,
          id: 'local-privacyPolicy',
          policyType: SbPolicyType.Privacy,
        }),
      )

      policyBatchRequester.request(dispatch, [id, SbPolicyType.Privacy, PRIVACY_POLICY_VERSION])
    }
  }
}

export function addTermsOfServiceNotificationIfNeeded(): ThunkAction {
  return (dispatch, getState) => {
    const {
      auth: {
        user: { id, acceptedTermsVersion },
      },
    } = getState()

    if (acceptedTermsVersion < TERMS_OF_SERVICE_VERSION) {
      dispatch(
        addLocalNotification<PolicyUpdatedNotification>({
          type: NotificationType.PolicyUpdated,
          id: 'local-termsOfService',
          policyType: SbPolicyType.TermsOfService,
        }),
      )

      policyBatchRequester.request(dispatch, [
        id,
        SbPolicyType.TermsOfService,
        TERMS_OF_SERVICE_VERSION,
      ])
    }
  }
}

export function addAcceptableUseNotificationIfNeeded(): ThunkAction {
  return (dispatch, getState) => {
    const {
      auth: {
        user: { id, acceptedUsePolicyVersion },
      },
    } = getState()

    if (acceptedUsePolicyVersion < ACCEPTABLE_USE_VERSION) {
      dispatch(
        addLocalNotification<PolicyUpdatedNotification>({
          type: NotificationType.PolicyUpdated,
          id: 'local-acceptableUse',
          policyType: SbPolicyType.AcceptableUse,
        }),
      )

      policyBatchRequester.request(dispatch, [
        id,
        SbPolicyType.AcceptableUse,
        ACCEPTABLE_USE_VERSION,
      ])
    }
  }
}
