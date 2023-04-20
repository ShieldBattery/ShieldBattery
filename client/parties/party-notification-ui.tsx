import React, { useCallback, useEffect } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { markNotificationsRead } from '../notifications/action-creators'
import { ActionableNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { blue300 } from '../styles/colors'
import { body2 } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'
import { acceptPartyInvite, declinePartyInvite } from './action-creators'

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
            <Username>{username ?? ''}</Username> sent you a party invitation.
          </span>
        }
        actions={[
          <TextButton key='decline' color='accent' label='Decline' onClick={onDecline} />,
          <TextButton key='accept' color='accent' label='Accept' onClick={onAccept} />,
        ]}
      />
    )
  }),
)
