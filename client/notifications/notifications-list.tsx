import { Immutable } from 'immer'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbNotification } from '../../common/notifications'
import { TextButton } from '../material/button'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, titleMedium } from '../styles/typography'
import { clearNotifications } from './action-creators'
import { notificationHasUi, NotificationUi } from './notification-to-ui'

const ListContainer = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
`

const TitleArea = styled.div`
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding-left: 16px; // no right padding because the button has built-in padding
`

const TitleText = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface-variant);
`

const ListArea = styled.div`
  flex-grow: 1;
  overflow-y: auto;
`

const EmptyList = styled.div`
  ${bodyLarge};
  padding: 32px 16px 48px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const ClearButton = styled(TextButton)`
  min-width: 84px;
  margin-right: 4px;
`

export interface NotificationsListProps {
  notifications: Immutable<SbNotification[]>
  onClear: () => void
}

export function NotificationsList(props: NotificationsListProps) {
  const { t } = useTranslation()

  const notifications = props.notifications.filter(n => notificationHasUi(n))

  return (
    <ListContainer>
      <TitleArea>
        <TitleText>{t('notifications.list.title', 'Notifications')}</TitleText>
        <ClearButton
          label={t('common.actions.clear', 'Clear')}
          onClick={props.onClear}
          testName='notifications-clear-button'
        />
      </TitleArea>
      <ListArea>
        {notifications.length > 0 ? (
          notifications.map((n, i) => (
            <NotificationUi
              key={`notif-${i}`}
              notification={n}
              showDivider={i < props.notifications.length - 1}
            />
          ))
        ) : (
          <EmptyList>{t('common.lists.empty', 'Nothing to see here')}</EmptyList>
        )}
      </ListArea>
    </ListContainer>
  )
}

export function ConnectedNotificationsList() {
  const idToNotification = useAppSelector(s => s.notifications.byId)
  const notificationIds = useAppSelector(s => s.notifications.orderedIds)
  const dispatch = useAppDispatch()
  const onClear = useCallback(() => dispatch(clearNotifications()), [dispatch])
  const orderedNotifications = useMemo(
    () => notificationIds.map(id => idToNotification.get(id)!),
    [notificationIds, idToNotification],
  )

  return <NotificationsList notifications={orderedNotifications} onClear={onClear} />
}
