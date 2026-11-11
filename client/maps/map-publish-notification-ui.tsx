import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, makeMapFamilyId } from '../../common/maps'
import {
  MapFileDelistedNotification,
  MapPublishApprovedNotification,
} from '../../common/notifications'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'

const DelistedIcon = styledWithAttrs(MaterialIcon, { icon: 'visibility_off', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-negative);
`

const ApprovedIcon = styledWithAttrs(MaterialIcon, { icon: 'public', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-positive);
`

export interface MapFileDelistedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: MapFileDelistedNotification
}

export function MapFileDelistedNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: MapFileDelistedNotificationUiProps) {
  const { t } = useTranslation()
  const name = filterColorCodes(notification.mapName)
  const url = urlForMap(
    makeMapFamilyId(notification.familyId),
    notification.mapName,
    undefined,
    notification.mapId,
  )
  const note = notification.note

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<DelistedIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='maps.publish.delistedNotification'>
            Staff took your map <Link href={url}>{{ name } as TransInterpolation}</Link> out of the
            listings.
          </Trans>
          {note ? (
            <>
              {' '}
              <Trans t={t} i18nKey='maps.publish.delistedNotificationNote'>
                Their note: “{{ note } as TransInterpolation}”
              </Trans>
            </>
          ) : null}
        </span>
      }
    />
  )
}

export interface MapPublishApprovedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: MapPublishApprovedNotification
}

export function MapPublishApprovedNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: MapPublishApprovedNotificationUiProps) {
  const { t } = useTranslation()
  const name = filterColorCodes(notification.mapName)
  const url = urlForMap(
    makeMapFamilyId(notification.familyId),
    notification.mapName,
    undefined,
    notification.mapId,
  )

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ApprovedIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='maps.publish.approvedNotification'>
            Your map <Link href={url}>{{ name } as TransInterpolation}</Link> was reviewed and is
            now listed.
          </Trans>
        </span>
      }
    />
  )
}
