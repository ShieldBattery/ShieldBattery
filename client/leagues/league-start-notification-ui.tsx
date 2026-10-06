import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { LeagueStartNotification } from '../../common/notifications'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'

const StartIcon = styledWithAttrs(MaterialIcon, { icon: 'trophy', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

export interface LeagueStartNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: LeagueStartNotification
}

export function LeagueStartNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: LeagueStartNotificationUiProps) {
  const { t } = useTranslation()
  const leagueName = notification.leagueName

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<StartIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='leagues.notifications.start'>
            The <strong>{{ leagueName } as TransInterpolation}</strong> league has started.
          </Trans>
        </span>
      }
    />
  )
}
