import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { MapOwnerKind } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RoomChip } from '../lobbies/room/room-parts'
import { Tooltip } from '../material/tooltip'
import { bodySmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const publishedDateFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const Byline = styled.div`
  ${bodySmall};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

/** Marks a maker staff confirmed. Sized to sit in a line of small text. */
const VerifiedChip = styled(RoomChip)`
  padding: 2px 6px;

  display: flex;
  align-items: center;
  gap: 2px;
`

/** A maker staff credited the map to, who has no account to link to. */
const CreditedMaker = styled.span`
  color: var(--theme-on-surface);
`

/** The Verified mark of a maker staff confirmed, with `tooltip` saying what staff confirmed. */
export function VerifiedMakerChip({ tooltip }: { tooltip: string }) {
  const { t } = useTranslation()
  return (
    <Tooltip text={tooltip} position='bottom'>
      <VerifiedChip>
        <MaterialIcon icon='verified' size={14} filled={true} />
        {t('maps.page.verified', 'Verified')}
      </VerifiedChip>
    </Tooltip>
  )
}

export interface MapBylineProps {
  /** The map's maker, if it has one. */
  owner?: { id: SbUserId }
  ownerKind?: MapOwnerKind
  /** The maker's name staff credited the map to, for a maker with no account. */
  credit?: string
  /** Who published the shown file, while it's listed. */
  publisher?: { id: SbUserId }
  publishedAt?: string
  /** Facts about the map shown at the end of the line, such as its player count and size. */
  facts?: string
  className?: string
}

/**
 * Who made the map and who published the shown file, on one line. The maker is the map's owner,
 * marked Verified when staff confirmed them, or else the name staff credited the map to.
 */
export function MapByline({
  owner,
  ownerKind,
  credit,
  publisher,
  publishedAt,
  facts,
  className,
}: MapBylineProps) {
  const { t } = useTranslation()
  const publishedDate = useFormat(publishedDateFormat)
  const date = publishedAt ? publishedDate.format(new Date(publishedAt)) : undefined

  let publishedPart: React.ReactNode
  if (publisher && date) {
    publishedPart =
      owner?.id === publisher.id ? (
        <span>{t('maps.page.publishedOn', { defaultValue: 'Published {{date}}', date })}</span>
      ) : (
        <>
          <span>{t('maps.page.publishedBy', 'Published by')}</span>
          <ConnectedUsername userId={publisher.id} />
          <span>·</span>
          <span>{date}</span>
        </>
      )
  }

  let makerPart: React.ReactNode
  if (owner) {
    makerPart = (
      <>
        <span>{t('maps.page.by', 'by')}</span>
        <ConnectedUsername userId={owner.id} />
        {ownerKind === MapOwnerKind.Staff ? (
          <VerifiedMakerChip
            tooltip={t('maps.page.verifiedTooltip', 'Staff confirmed this user made the map')}
          />
        ) : null}
      </>
    )
  } else if (credit) {
    makerPart = (
      <>
        <span>{t('maps.page.by', 'by')}</span>
        <CreditedMaker>{credit}</CreditedMaker>
      </>
    )
  }

  if (!makerPart && !publishedPart && !facts) {
    return null
  }
  return (
    <Byline className={className}>
      {makerPart}
      {makerPart && (publishedPart || facts) ? <span>·</span> : null}
      {publishedPart}
      {publishedPart && facts ? <span>·</span> : null}
      {facts ? <span>{facts}</span> : null}
    </Byline>
  )
}
