import React, { useCallback, useEffect } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import SupervisedUser from '../icons/material/supervised_user_circle_black_24px.svg'
import { TextButton } from '../material/button'
import { markNotificationsRead } from '../notifications/action-creators'
import { ActionableNotification } from '../notifications/notifications'
import { getBatchUserInfo } from '../profile/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { blue300 } from '../styles/colors'
import { body2 } from '../styles/typography'
import { acceptPartyInvite, declinePartyInvite } from './action-creators'

const ColoredPartyIcon = styled(SupervisedUser)`
  width: 36px;
  height: 36px;
  flex-shrink: 0;

  color: ${blue300};
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
