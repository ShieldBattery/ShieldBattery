import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  ChannelBanNotification,
  ChannelKickNotification,
  ChannelUnbanNotification,
} from '../../common/notifications'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'

const KickIcon = styledWithAttrs(MaterialIcon, { icon: 'person_remove', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-negative);
`

const BanIcon = styledWithAttrs(MaterialIcon, { icon: 'gavel', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-negative);
`

const UnbanIcon = styledWithAttrs(MaterialIcon, { icon: 'how_to_reg', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-positive);
`

export interface ChannelKickNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: ChannelKickNotification
}

export function ChannelKickNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: ChannelKickNotificationUiProps) {
  const { t } = useTranslation()
  const channelName = notification.channelName

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<KickIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='chat.notifications.kick'>
            You have been kicked from <strong>#{{ channelName } as TransInterpolation}</strong>.
          </Trans>
        </span>
      }
    />
  )
}

export interface ChannelBanNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: ChannelBanNotification
}

export function ChannelBanNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: ChannelBanNotificationUiProps) {
  const { t } = useTranslation()
  const channelName = notification.channelName

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<BanIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='chat.notifications.ban'>
            You have been banned from <strong>#{{ channelName } as TransInterpolation}</strong>.
          </Trans>
        </span>
      }
    />
  )
}

export interface ChannelUnbanNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: ChannelUnbanNotification
}

export function ChannelUnbanNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: ChannelUnbanNotificationUiProps) {
  const { t } = useTranslation()
  const channelName = notification.channelName

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<UnbanIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='chat.notifications.unban'>
            Your ban from <strong>#{{ channelName } as TransInterpolation}</strong> has been lifted.
          </Trans>
        </span>
      }
    />
  )
}
