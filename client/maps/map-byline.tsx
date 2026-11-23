import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { MapOwnerKind } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
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

/** Marks a maker staff confirmed. Centres its icon vertically in a line of small text. */
const VerifiedMark = styled.span`
  display: flex;
  align-items: center;

  color: var(--theme-primary);
`

/** The name of a maker who has an account, as an accented link. */
const MakerName = styled(ConnectedUsername)`
  color: var(--theme-amber);
  font-weight: 500;
`

/**
 * Who published the shown file and when, plus the separator leading into it. Smaller and fainter
 * than the rest of the line, and sized by its own rule so a byline restyling its root's text size
 * doesn't resize it.
 */
const PublishedPart = styled.span`
  ${bodySmall};
  color: var(--color-grey-blue60);

  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
`

/** A maker staff credited the map to, who has no account to link to. */
const CreditedMaker = styled.span`
  color: var(--theme-on-surface);
`

/** The Verified icon of a maker staff confirmed, with `tooltip` saying what staff confirmed. */
export function VerifiedMakerIcon({ tooltip }: { tooltip: string }) {
  const { t } = useTranslation()
  return (
    <Tooltip text={tooltip} position='bottom'>
      <VerifiedMark role='img' aria-label={t('maps.page.verified', 'Verified')}>
        <MaterialIcon icon='verified' size={16} filled={true} />
      </VerifiedMark>
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
 * marked Verified when staff confirmed them, or else the name staff credited the map to. The
 * maker's name is accented, and the published part is smaller and fainter.
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
        <MakerName userId={owner.id} />
        {ownerKind === MapOwnerKind.Staff ? (
          <VerifiedMakerIcon
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
      {makerPart && facts && !publishedPart ? <span>·</span> : null}
      {publishedPart ? (
        <PublishedPart>
          {makerPart ? <span>·</span> : null}
          {publishedPart}
        </PublishedPart>
      ) : null}
      {publishedPart && facts ? <span>·</span> : null}
      {facts ? <span>{facts}</span> : null}
    </Byline>
  )
}
