import { useTranslation } from 'react-i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'

const ColoredIcon = styledWithAttrs(MaterialIcon, { size: 36 })`
  flex-shrink: 0;
  color: var(--theme-positive);
`

export interface GameReportActionedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
}

export function GameReportActionedNotificationUi({
  ref,
  showDivider,
  read,
}: GameReportActionedNotificationUiProps) {
  const { t } = useTranslation()

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon icon='flag' />}
      text={t(
        'games.reporting.actionedNotification',
        'Action was taken against a player you reported. Thanks for helping keep the community fair.',
      )}
    />
  )
}
