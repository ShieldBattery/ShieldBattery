import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { SbPolicyType, policyTypeToLabel } from '../../common/policies/policy-type'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch } from '../redux-hooks'
import { amberA400 } from '../styles/colors'

const ColoredPolicyIcon = styled(MaterialIcon).attrs({ icon: 'policy', size: 36 })`
  flex-shrink: 0;
  color: ${amberA400};
`

export interface PolicyUpdateNotificationUiProps {
  policyType: SbPolicyType
  showDivider: boolean
  read: boolean
}

export const PolicyUpdateNotificationUi = React.forwardRef<
  HTMLDivElement,
  PolicyUpdateNotificationUiProps
>(({ policyType, showDivider, read }, ref) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const label = policyTypeToLabel(policyType)
  const dialogType = policyTypeToDialogType(policyType)

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredPolicyIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='policy.policyUpdateNotification'>
            ShieldBattery's{' '}
            <a
              href='#'
              onClick={e => {
                e.preventDefault()
                dispatch(openDialog({ type: dialogType }))
              }}>
              {{ label } as TransInterpolation}
            </a>{' '}
            has been updated.
          </Trans>
        </span>
      }
    />
  )
})

function policyTypeToDialogType(
  policyType: SbPolicyType,
): DialogType.AcceptableUse | DialogType.PrivacyPolicy | DialogType.TermsOfService {
  switch (policyType) {
    case SbPolicyType.AcceptableUse:
      return DialogType.AcceptableUse
    case SbPolicyType.Privacy:
      return DialogType.PrivacyPolicy
    case SbPolicyType.TermsOfService:
      return DialogType.TermsOfService
    default:
      return assertUnreachable(policyType)
  }
}
