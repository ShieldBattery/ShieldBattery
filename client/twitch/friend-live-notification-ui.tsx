import * as React from 'react'
import { forwardRef, memo, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { TransInterpolation } from '../i18n/i18next'
import { TextButton } from '../material/button'
import { ActionableNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { titleSmall } from '../styles/typography'
import { getBatchUserInfo, navigateToUserProfile } from '../users/action-creators'

const Username = styled.span`
  ${titleSmall};
`

const StyledAvatar = styled(ConnectedAvatar)`
  width: 36px;
  height: 36px;
  flex-shrink: 0;
`

export interface StreamLiveNotificationUiProps {
  userId: SbUserId
  showDivider: boolean
  read: boolean
  ref?: React.Ref<HTMLDivElement>
}

export const StreamLiveNotificationUi = memo(
  forwardRef<HTMLDivElement, StreamLiveNotificationUiProps>((props, ref) => {
    const { t } = useTranslation()
    const { userId } = props
    const dispatch = useAppDispatch()
    const username = useAppSelector(s => s.users.byId.get(userId)?.name)

    useEffect(() => {
      dispatch(getBatchUserInfo(userId))
    }, [userId, dispatch])

    return (
      <ActionableNotification
        ref={ref}
        showDivider={props.showDivider}
        read={props.read}
        icon={<StyledAvatar userId={userId} />}
        text={
          <span>
            <Trans t={t} i18nKey='twitch.live.friendLiveNotification'>
              <Username>{{ user: username ?? '' } as TransInterpolation}</Username> is now live on
              Twitch.
            </Trans>
          </span>
        }
        actions={[
          <TextButton
            key='watch'
            label={t('twitch.live.friendLiveWatch', 'Watch')}
            onClick={() => navigateToUserProfile(userId, username ?? '')}
          />,
        ]}
      />
    )
  }),
)
