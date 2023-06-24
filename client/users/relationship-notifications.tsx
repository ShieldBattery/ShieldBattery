import React, { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { markNotificationsRead } from '../notifications/action-creators'
import { ActionableNotification, ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { blue300 } from '../styles/colors'
import { body2 } from '../styles/typography'
import { acceptFriendRequest, declineFriendRequest, getBatchUserInfo } from './action-creators'

const ColoredAddIcon = styled(MaterialIcon).attrs({ icon: 'group_add', size: 36 })`
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
    const { t } = useTranslation()
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
            <Trans t={t} i18nKey='users.friendsList.receivedFriendRequest'>
              <Username>{{ user: username ?? '' } as TransInterpolation}</Username> sent you a
              friend request.
            </Trans>
          </span>
        }
        actions={[
          <TextButton
            key='decline'
            color='accent'
            label={t('common.actions.decline', 'Decline')}
            onClick={() => {
              dispatch(
                declineFriendRequest(from, {
                  onSuccess: () => {},
                  onError: _err => {
                    dispatch(
                      openSnackbar({
                        message: t(
                          'users.errors.friendsList.errorDecliningFriendRequest',
                          'Error declining friend request',
                        ),
                      }),
                    )
                  },
                }),
              )
              dispatch(markNotificationsRead([notificationId]))
            }}
          />,
          <TextButton
            key='accept'
            color='accent'
            label={t('common.actions.accept', 'Accept')}
            onClick={() => {
              dispatch(
                acceptFriendRequest(from, {
                  onSuccess: () => {},
                  onError: _err => {
                    dispatch(
                      openSnackbar({
                        message: t(
                          'users.errors.friendsList.errorAcceptingFriendRequest',
                          'Error accepting friend request',
                        ),
                      }),
                    )
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

const ColoredFriendStartIcon = styled(MaterialIcon).attrs({ icon: 'group', size: 36 })`
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
    const { t } = useTranslation()
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
            <Trans t={t} i18nKey='users.friendsList.friendStart'>
              You are now friends with{' '}
              <Username>{{ user: username ?? '' } as TransInterpolation}</Username>.
            </Trans>
          </span>
        }
      />
    )
  }),
)
