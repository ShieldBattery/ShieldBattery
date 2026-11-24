import { memo, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SbUserId } from '../../common/users/sb-user-id'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { useJoinLobbyAction } from '../lobbies/use-join-lobby-action'
import { TextButton } from '../material/button'
import { markNotificationsRead } from '../notifications/action-creators'
import { ActionableNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { titleSmall } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'

const ColoredAddIcon = styledWithAttrs(MaterialIcon, { icon: 'group_add', size: 36 })`
  flex-shrink: 0;
  color: var(--color-blue80);
`

const Username = styled.span`
  ${titleSmall};
`

export interface LobbyInviteNotificationUiProps {
  from: SbUserId
  lobbyId: SbLobbyId
  notificationId: string
  showDivider: boolean
  read: boolean
  ref?: React.Ref<HTMLDivElement>
}

export const LobbyInviteNotificationUi = memo(function LobbyInviteNotificationUi({
  from,
  lobbyId,
  notificationId,
  showDivider,
  read,
  ref,
}: LobbyInviteNotificationUiProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [joinLobby] = useJoinLobbyAction()
  const username = useAppSelector(s => s.users.byId.get(from)?.name)

  useEffect(() => {
    dispatch(getBatchUserInfo(from))
  }, [from, dispatch])

  return (
    <ActionableNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredAddIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='lobbies.inviteNotification.received'>
            <Username>{{ user: username ?? '' } as TransInterpolation}</Username> invited you to a
            lobby.
          </Trans>
        </span>
      }
      actions={[
        <TextButton
          key='decline'
          label={t('common.actions.decline', 'Decline')}
          onClick={() => {
            dispatch(markNotificationsRead([notificationId]))
          }}
        />,
        <TextButton
          key='accept'
          label={t('common.actions.accept', 'Accept')}
          onClick={() => {
            joinLobby(lobbyId)
          }}
        />,
      ]}
    />
  )
})
