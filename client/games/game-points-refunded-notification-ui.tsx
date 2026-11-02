import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GamePointsRefundedNotification } from '../../common/notifications'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { titleSmall } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'

const ColoredIcon = styledWithAttrs(MaterialIcon, { size: 36 })`
  flex-shrink: 0;
  color: var(--theme-positive);
`

const Username = styled.span`
  ${titleSmall};
`

export interface GamePointsRefundedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: GamePointsRefundedNotification
}

export function GamePointsRefundedNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: GamePointsRefundedNotificationUiProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { culpritId } = notification
  const count = notification.gameCount ?? 1
  const user = useAppSelector(s => (culpritId ? s.users.byId.get(culpritId)?.name : undefined))

  useEffect(() => {
    if (culpritId) {
      dispatch(getBatchUserInfo(culpritId))
    }
  }, [culpritId, dispatch])

  // A single game gets its own strings, since plural forms would have to read "1 game" there.
  let text: React.ReactNode
  if (culpritId && count > 1) {
    text = (
      <Trans t={t} i18nKey='games.reporting.pointsRefundedNotificationGamesWith' count={count}>
        Ranked points you lost in {{ count }} games with{' '}
        <Username>{{ user: user ?? '' } as TransInterpolation}</Username> have been refunded to you.
      </Trans>
    )
  } else if (culpritId) {
    text = (
      <Trans t={t} i18nKey='games.reporting.pointsRefundedNotificationWith'>
        Ranked points you lost in a game with{' '}
        <Username>{{ user: user ?? '' } as TransInterpolation}</Username> have been refunded to you.
      </Trans>
    )
  } else if (count > 1) {
    text = t('games.reporting.pointsRefundedNotificationGames', {
      defaultValue:
        'Ranked points you lost in {{count}} games have been refunded to you after they were ' +
        'reviewed.',
      count,
    })
  } else {
    text = t(
      'games.reporting.pointsRefundedNotification',
      'Ranked points you lost in a game have been refunded to you after the game was reviewed.',
    )
  }

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon icon='paid' />}
      text={<span>{text}</span>}
    />
  )
}
