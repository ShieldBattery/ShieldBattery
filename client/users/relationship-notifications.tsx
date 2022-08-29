import React, { useEffect } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import FriendsIcon from '../icons/material/group-24px.svg'
import FriendAddIcon from '../icons/material/group_add-24px.svg'
import { TextButton } from '../material/button'
import { markNotificationsRead } from '../notifications/action-creators'
import { ActionableNotification, ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { blue300 } from '../styles/colors'
import { body2 } from '../styles/typography'
import { acceptFriendRequest, declineFriendRequest, getBatchUserInfo } from './action-creators'

const ColoredAddIcon = styled(FriendAddIcon)`
  width: 36px;
  height: 36px;
  flex-shrink: 0;

  color: ${blue300};
`

const Username = styled.span`
  ${body2};
`

export interface FriendRequestNotificationUiProps {
  from: SbUserId
  notificationId: string
  showDivider: boolean
  read: boolean
}

export const FriendRequestNotificationUi = React.memo(
  React.forwardRef<HTMLDivElement, FriendRequestNotificationUiProps>((props, ref) => {
    const { notificationId, from } = props
    const dispatch = useAppDispatch()
    const username = useAppSelector(s => s.users.byId.get(from)?.name)

    useEffect(() => {
      dispatch(getBatchUserInfo(from))
    }, [from, dispatch])

    return (
      <ActionableNotification
        ref={ref}
        showDivider={props.showDivider}
        read={props.read}
        icon={<ColoredAddIcon />}
        text={
          <span>
            <Username>{username ?? ''}</Username> sent you a friend request.
          </span>
        }
        actions={[
          <TextButton
            key='decline'
            color='accent'
            label='Decline'
            onClick={() => {
              dispatch(
                declineFriendRequest(from, {
                  onSuccess: () => {},
                  onError: _err => {
                    dispatch(openSnackbar({ message: 'Error declining friend request' }))
                  },
                }),
              )
              dispatch(markNotificationsRead([notificationId]))
            }}
          />,
          <TextButton
            key='accept'
            color='accent'
            label='Accept'
            onClick={() => {
              dispatch(
                acceptFriendRequest(from, {
                  onSuccess: () => {},
                  onError: _err => {
                    dispatch(openSnackbar({ message: 'Error accepting friend request' }))
                  },
                }),
              )
              dispatch(markNotificationsRead([notificationId]))
            }}
          />,
        ]}
      />
    )
  }),
)

const ColoredFriendStartIcon = styled(FriendsIcon)`
  width: 36px;
  height: 36px;
  flex-shrink: 0;

  color: ${blue300};
`

export interface FriendStartNotificationUiProps {
  otherUser: SbUserId
  showDivider: boolean
  read: boolean
}

export const FriendStartNotificationUi = React.memo(
  React.forwardRef<HTMLDivElement, FriendStartNotificationUiProps>((props, ref) => {
    const { otherUser } = props
    const dispatch = useAppDispatch()
    const username = useAppSelector(s => s.users.byId.get(otherUser)?.name)

    useEffect(() => {
      dispatch(getBatchUserInfo(otherUser))
    }, [otherUser, dispatch])

    return (
      <ActionlessNotification
        ref={ref}
        showDivider={props.showDivider}
        read={props.read}
        icon={<ColoredFriendStartIcon />}
        text={
          <span>
            You are now friends with <Username>{username ?? ''}</Username>.
          </span>
        }
      />
    )
  }),
)
