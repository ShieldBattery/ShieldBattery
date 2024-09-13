import React, { useCallback, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { SbUserId } from '../../common/users/sb-user.js'
import { TransInterpolation } from '../i18n/i18next.js'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { TextButton } from '../material/button.js'
import { markNotificationsRead } from '../notifications/action-creators.js'
import { ActionableNotification } from '../notifications/notifications.js'
import { useAppDispatch, useAppSelector } from '../redux-hooks.js'
import { blue300 } from '../styles/colors.js'
import { body2 } from '../styles/typography.js'
import { getBatchUserInfo } from '../users/action-creators.js'
import { acceptPartyInvite, declinePartyInvite } from './action-creators.js'

const ColoredPartyIcon = styled(MaterialIcon).attrs({ icon: 'supervised_user_circle', size: 36 })`
  color: ${blue300};
  flex-shrink: 0;
`

const Username = styled.span`
  ${body2};
`

export interface PartyInviteNotificationUiProps {
  from: SbUserId
  partyId: string
  notificationId: string
  showDivider: boolean
  read: boolean
}

export const PartyInviteNotificationUi = React.memo(
  React.forwardRef<HTMLDivElement, PartyInviteNotificationUiProps>((props, ref) => {
    const { notificationId, partyId } = props
    const { t } = useTranslation()
    const dispatch = useAppDispatch()
    const onDecline = useCallback(() => {
      dispatch(declinePartyInvite(partyId))
      dispatch(markNotificationsRead([notificationId]))
    }, [notificationId, partyId, dispatch])
    const onAccept = useCallback(() => {
      dispatch(acceptPartyInvite(partyId))
      dispatch(markNotificationsRead([notificationId]))
    }, [notificationId, partyId, dispatch])
    const from = props.from
    const username = useAppSelector(s => s.users.byId.get(from)?.name)

    useEffect(() => {
      dispatch(getBatchUserInfo(from))
    }, [from, dispatch])

    return (
      <ActionableNotification
        ref={ref}
        showDivider={props.showDivider}
        read={props.read}
        icon={<ColoredPartyIcon />}
        text={
          <span>
            <Trans t={t} i18nKey='parties.notificationUi'>
              <Username>{{ user: username ?? '' } as TransInterpolation}</Username> sent you a party
              invitation.
            </Trans>
          </span>
        }
        actions={[
          <TextButton
            key='decline'
            color='accent'
            label={t('common.actions.decline', 'Decline')}
            onClick={onDecline}
          />,
          <TextButton
            key='accept'
            color='accent'
            label={t('common.actions.accept', 'Accept')}
            onClick={onAccept}
          />,
        ]}
      />
    )
  }),
)
