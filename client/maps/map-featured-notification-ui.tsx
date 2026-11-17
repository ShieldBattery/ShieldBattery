import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { urlForMap, urlForMapCollection } from '../../common/map-url'
import { filterColorCodes } from '../../common/maps'
import { MapFeaturedNotification } from '../../common/notifications'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'

const FeaturedIcon = styledWithAttrs(MaterialIcon, { icon: 'star', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

export interface MapFeaturedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: MapFeaturedNotification
}

export function MapFeaturedNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: MapFeaturedNotificationUiProps) {
  const { t } = useTranslation()
  const { pick } = notification

  let text: React.ReactNode
  switch (pick.kind) {
    case 'map': {
      const name = filterColorCodes(pick.name)
      text = (
        <Trans t={t} i18nKey='maps.feature.mapOfTheWeekNotification'>
          <Link href={urlForMap(pick.id, pick.name)}>{{ name } as TransInterpolation}</Link> is map
          of the week
        </Trans>
      )
      break
    }
    case 'collection': {
      const name = pick.name
      text = (
        <Trans t={t} i18nKey='maps.feature.collectionOfTheWeekNotification'>
          <Link href={urlForMapCollection(pick.id, pick.name)}>
            {{ name } as TransInterpolation}
          </Link>{' '}
          is collection of the week
        </Trans>
      )
      break
    }
  }

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<FeaturedIcon />}
      text={<span>{text}</span>}
    />
  )
}
