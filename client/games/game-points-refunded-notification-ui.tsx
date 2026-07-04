import { useTranslation } from 'react-i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'

const ColoredIcon = styledWithAttrs(MaterialIcon, { size: 36 })`
  flex-shrink: 0;
  color: var(--theme-positive);
`

export interface GamePointsRefundedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
}

export function GamePointsRefundedNotificationUi({
  ref,
  showDivider,
  read,
}: GamePointsRefundedNotificationUiProps) {
  const { t } = useTranslation()

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon icon='paid' />}
      text={t(
        'games.reporting.pointsRefundedNotification',
        'Ranked points you lost in a game have been refunded to you after the game was reviewed.',
      )}
    />
  )
}
