import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { LeagueBanNotification, LeagueUnbanNotification } from '../../common/notifications'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { useLocalizedLeague } from './use-localized-league'

const BanIcon = styledWithAttrs(MaterialIcon, { icon: 'gavel', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-negative);
`

const UnbanIcon = styledWithAttrs(MaterialIcon, { icon: 'how_to_reg', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-positive);
`

export interface LeagueBanNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: LeagueBanNotification
}

export function LeagueBanNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: LeagueBanNotificationUiProps) {
  const { t } = useTranslation()
  const { name: leagueName } = useLocalizedLeague({
    name: notification.leagueName,
    translations: Object.entries(notification.leagueNameTranslations ?? {}).map(
      ([language, name]) => ({ language, name }),
    ),
  })

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<BanIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='leagues.notifications.ban'>
            You have been banned from the <strong>{{ leagueName } as TransInterpolation}</strong>{' '}
            league.
          </Trans>
        </span>
      }
    />
  )
}

export interface LeagueUnbanNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: LeagueUnbanNotification
}

export function LeagueUnbanNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: LeagueUnbanNotificationUiProps) {
  const { t } = useTranslation()
  const { name: leagueName } = useLocalizedLeague({
    name: notification.leagueName,
    translations: Object.entries(notification.leagueNameTranslations ?? {}).map(
      ([language, name]) => ({ language, name }),
    ),
  })

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<UnbanIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='leagues.notifications.unban'>
            Your ban from the <strong>{{ leagueName } as TransInterpolation}</strong> league has
            been lifted.
          </Trans>
        </span>
      }
    />
  )
}
