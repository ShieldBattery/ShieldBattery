import React, { useCallback } from 'react'
import styled from 'styled-components'
import SupervisedUser from '../icons/material/supervised_user_circle_black_24dp.svg'
import FlatButton from '../material/flat-button'
import { markNotificationsRead } from '../notifications/action-creators'
import { ActionableNotification } from '../notifications/notifications'
import { useAppDispatch } from '../redux-hooks'
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
  from: string
  partyId: string
  notificationId: string
  showDivider: boolean
  unread: boolean
}

export const PartyInviteNotificationUi = React.forwardRef<
  HTMLDivElement,
  PartyInviteNotificationUiProps
>((props, ref) => {
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

  return (
    <ActionableNotification
      ref={ref}
      showDivider={props.showDivider}
      unread={props.unread}
      icon={<ColoredPartyIcon />}
      text={
        <span>
          <Username>{props.from}</Username> sent you a party invitation.
        </span>
      }
      actions={[
        <FlatButton key='decline' color='accent' label='Decline' onClick={onDecline} />,
        <FlatButton key='accept' color='accent' label='Accept' onClick={onAccept} />,
      ]}
    />
  )
})
