import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, makeMapFamilyId } from '../../common/maps'
import { MapOwnerNotification } from '../../common/notifications'
import { SbUserId } from '../../common/users/sb-user-id'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { titleSmall } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'

const PositiveIcon = styledWithAttrs(MaterialIcon, { icon: 'verified', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-positive);
`

const NegativeIcon = styledWithAttrs(MaterialIcon, { icon: 'person_remove', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-negative);
`

const FileIcon = styledWithAttrs(MaterialIcon, { icon: 'swap_horiz', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const Username = styled.span`
  ${titleSmall};
`

function useUsername(userId: SbUserId | undefined) {
  const dispatch = useAppDispatch()
  const username = useAppSelector(s => (userId ? s.users.byId.get(userId)?.name : undefined))

  useEffect(() => {
    if (userId) {
      dispatch(getBatchUserInfo(userId))
    }
  }, [userId, dispatch])

  return username
}

export interface MapOwnerNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  notification: MapOwnerNotification
}

export function MapOwnerNotificationUi({
  ref,
  showDivider,
  read,
  notification,
}: MapOwnerNotificationUiProps) {
  const { t } = useTranslation()
  const { event } = notification
  const actorId =
    event.kind === 'fileAdded' || event.kind === 'fileRemoved' ? event.actorId : undefined
  const actor = useUsername(actorId) ?? ''
  const name = filterColorCodes(notification.mapName)
  const url = urlForMap(makeMapFamilyId(notification.familyId), notification.mapName)

  let icon: React.ReactNode
  let text: React.ReactNode
  switch (event.kind) {
    case 'claimGranted':
      icon = <PositiveIcon />
      text = (
        <Trans t={t} i18nKey='maps.owner.claimGrantedNotification'>
          Staff confirmed you as the maker of{' '}
          <Link href={url}>{{ name } as TransInterpolation}</Link>.
        </Trans>
      )
      break
    case 'claimRejected':
      icon = <NegativeIcon />
      text = (
        <Trans t={t} i18nKey='maps.owner.claimRejectedNotification'>
          Staff turned down your claim to <Link href={url}>{{ name } as TransInterpolation}</Link>.
        </Trans>
      )
      break
    case 'ownerSet':
      icon = <PositiveIcon />
      text = (
        <Trans t={t} i18nKey='maps.owner.ownerSetNotification'>
          Staff made you the maker of <Link href={url}>{{ name } as TransInterpolation}</Link>.
        </Trans>
      )
      break
    case 'ownershipRemoved':
      icon = <NegativeIcon />
      text = (
        <Trans t={t} i18nKey='maps.owner.ownershipRemovedNotification'>
          You are no longer the maker of <Link href={url}>{{ name } as TransInterpolation}</Link>.
        </Trans>
      )
      break
    case 'fileAdded': {
      const file = filterColorCodes(event.fileName)
      icon = <FileIcon />
      text = (
        <Trans t={t} i18nKey='maps.owner.fileAddedNotification'>
          <Username>{{ actor } as TransInterpolation}</Username> added{' '}
          {{ file } as TransInterpolation} to your map{' '}
          <Link href={url}>{{ name } as TransInterpolation}</Link>.
        </Trans>
      )
      break
    }
    case 'fileRemoved': {
      const file = filterColorCodes(event.fileName)
      icon = <FileIcon />
      text = (
        <Trans t={t} i18nKey='maps.owner.fileRemovedNotification'>
          <Username>{{ actor } as TransInterpolation}</Username> removed{' '}
          {{ file } as TransInterpolation} from your map{' '}
          <Link href={url}>{{ name } as TransInterpolation}</Link>.
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
      icon={icon}
      text={<span>{text}</span>}
    />
  )
}
