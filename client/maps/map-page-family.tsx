import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { urlForMap, urlForMapCompare } from '../../common/map-url'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { urlPath } from '../../common/urls'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapFamilyRelation, MapVersionStatus } from '../gql/graphql'
import { TransInterpolation } from '../i18n/i18next'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RoomChip, SectionLabel } from '../lobbies/room/room-parts'
import { IconButton, TextButton } from '../material/button'
import { Callout } from '../material/callout'
import { Card } from '../material/card'
import { LinkButton } from '../material/link-button'
import { Tooltip } from '../material/tooltip'
import { bodyMedium, bodySmall, labelMedium, singleLine, titleSmall } from '../styles/typography'
import { collapseFamilyLines, familyLines } from './map-family-lines'

const MapPage_NewerVersionFragment = graphql(/* GraphQL */ `
  fragment MapPage_NewerVersionFragment on SbMap {
    id
    newerVersion {
      id
      name
    }
  }
`)

const OlderVersionLink = styled(Link)`
  ${titleSmall};
  overflow-wrap: anywhere;
`

/** Points from an older version of a map to the latest one. */
export function MapNewerVersionBanner({
  map: mapRef,
}: {
  map: FragmentType<typeof MapPage_NewerVersionFragment>
}) {
  const { t } = useTranslation()
  const map = useFragment(MapPage_NewerVersionFragment, mapRef)
  const newer = map.newerVersion
  if (!newer) {
    return null
  }

  const name = filterColorCodes(newer.name)
  return (
    <Callout variant='inline' icon='history'>
      <Trans t={t} i18nKey='maps.page.olderVersionNotice'>
        This is an older version.{' '}
        <OlderVersionLink href={urlForMap(newer.id, newer.name)}>
          {{ name } as TransInterpolation}
        </OlderVersionLink>{' '}
        is the latest one.
      </Trans>
    </Callout>
  )
}

const MapPage_FamilyFragment = graphql(/* GraphQL */ `
  fragment MapPage_FamilyFragment on SbMap {
    id
    listed
    firstSeenAt
    family {
      id
      members {
        id
        mapId
        parentId
        relation
        versionLabel
        isCurrent
        map {
          id
          name
          firstSeenAt
          versionStatus
          stats {
            id
            gamesTotal
          }
        }
      }
    }
    similarMaps {
      id
    }
  }
`)

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

const FamilyCard = styled(Card)`
  padding: 16px 20px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const InfoIcon = styled(MaterialIcon).attrs({ icon: 'info', size: 16 })`
  display: block;
  color: var(--theme-on-surface-variant);
`

const Lines = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Line = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const LineHeader = styled.div`
  ${labelMedium};
  ${singleLine};
  padding-top: 12px;
  border-top: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
`

const Row = styled.div`
  min-height: 40px;

  display: flex;
  align-items: center;
  gap: 4px;
`

const RowText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const RowTitle = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

const MemberName = styled.span`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

const MemberLink = styled(Link)`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
`

const LatestChip = styled(RoomChip)`
  flex-shrink: 0;
  padding: 2px 8px;
  background-color: rgb(from var(--theme-positive) r g b / 0.16);
  color: var(--theme-positive);
`

const RowSubtitle = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const ShowAllButton = styled(TextButton)`
  align-self: flex-start;
  /** Lines the label up with the rows, past the button's own padding. */
  margin-left: -16px;
`

const ReviewPrompt = styled.div`
  ${bodyMedium};
  padding-top: 8px;
  border-top: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
`

/** A member's name with its version, when the name doesn't already say it. */
function memberName(name: string, versionLabel: string | null | undefined): string {
  const filtered = filterColorCodes(name)
  return versionLabel && !filtered.includes(versionLabel) ? `${filtered} ${versionLabel}` : filtered
}

/** The pair in before/after order for comparing them: the file uploaded first is the before side. */
function compareOrder(
  a: { id: SbMapId; firstSeenAt: string },
  b: { id: SbMapId; firstSeenAt: string },
): [before: SbMapId, after: SbMapId] {
  return Date.parse(a.firstSeenAt) <= Date.parse(b.firstSeenAt) ? [a.id, b.id] : [b.id, a.id]
}

/** A family member as the versions list shows it. */
export interface VersionsListMember {
  mapId: SbMapId
  parentId: SbMapId | undefined
  relation: MapFamilyRelation
  versionLabel: string | undefined
  isCurrent: boolean
  status: MapVersionStatus
  name: string
  games: number
  firstSeenAt: string
}

/**
 * A family's files, one group per map with each file's place in plain words. With `hereId`, long
 * families start collapsed around that file and every other file can be compared with it.
 */
export function FamilyVersionsList({
  members,
  hereId,
  linkMaps = true,
}: {
  members: ReadonlyArray<VersionsListMember>
  hereId?: SbMapId
  linkMaps?: boolean
}) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  const [expanded, setExpanded] = useState(false)

  const byId = new Map(members.map(m => [m.mapId, m]))
  const allLines = familyLines(
    members.map(m => ({
      mapId: m.mapId,
      parentId: m.parentId,
      relation: m.relation,
      isCurrent: m.isCurrent,
      firstSeenAt: Date.parse(m.firstSeenAt),
    })),
  )
  const collapsed = hereId
    ? collapseFamilyLines(allLines, hereId, id => !!byId.get(id)?.isCurrent)
    : { lines: allLines, hiddenCount: 0 }
  const lines = expanded ? allLines : collapsed.lines
  const here = hereId ? byId.get(hereId) : undefined

  /** How a file that isn't its line's latest relates to it. */
  const statusText = (member: VersionsListMember): string => {
    const parentVersion = member.parentId ? byId.get(member.parentId)?.versionLabel : undefined
    switch (member.status) {
      case MapVersionStatus.Superseded:
        return t('maps.family.olderVersion', 'Older version')
      case MapVersionStatus.Variant:
        return parentVersion
          ? t('maps.family.copyOf', { defaultValue: 'Copy of {{version}}', version: parentVersion })
          : t('maps.family.copy', 'Copy')
      case MapVersionStatus.Translation:
        return parentVersion
          ? t('maps.family.translationOf', {
              defaultValue: 'Translation of {{version}}',
              version: parentVersion,
            })
          : t('maps.family.translation', 'Translation')
      default:
        return t('maps.family.otherVersion', 'Other version')
    }
  }

  const compareLabel = t('maps.family.compareWithThis', 'Compare with this map')

  return (
    <>
      <Lines>
        {lines.map(line => (
          <Line key={line.topId}>
            {line.basedOnId ? (
              <LineHeader>
                {t('maps.family.basedOn', {
                  defaultValue: 'Based on {{name}}',
                  name: memberName(
                    byId.get(line.basedOnId)?.name ?? '',
                    byId.get(line.basedOnId)?.versionLabel,
                  ),
                })}
              </LineHeader>
            ) : null}
            {line.rows.map(id => {
              const member = byId.get(id)!
              const isHere = member.mapId === hereId
              const name = memberName(member.name, member.versionLabel)

              return (
                <Row key={id}>
                  <RowText>
                    <RowTitle>
                      {isHere || !linkMaps ? (
                        <MemberName title={name}>{name}</MemberName>
                      ) : (
                        <MemberLink href={urlForMap(member.mapId, member.name)} title={name}>
                          {name}
                        </MemberLink>
                      )}
                      {member.isCurrent ? (
                        <LatestChip>{t('maps.family.latest', 'Latest')}</LatestChip>
                      ) : null}
                    </RowTitle>
                    <RowSubtitle>
                      {[
                        member.isCurrent ? undefined : statusText(member),
                        t('maps.family.games', {
                          defaultValue: '{{formattedCount}} games',
                          defaultValue_one: '{{formattedCount}} game',
                          count: member.games,
                          formattedCount: numbers.format(member.games),
                        }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </RowSubtitle>
                  </RowText>
                  {!here || isHere ? null : (
                    <Tooltip text={compareLabel} position='left' tabIndex={-1}>
                      <LinkButton
                        href={urlForMapCompare(
                          ...compareOrder(
                            { id: member.mapId, firstSeenAt: member.firstSeenAt },
                            { id: here.mapId, firstSeenAt: here.firstSeenAt },
                          ),
                        )}>
                        <IconButton
                          styledAs='div'
                          icon={<MaterialIcon icon='compare' />}
                          ariaLabel={compareLabel}
                        />
                      </LinkButton>
                    </Tooltip>
                  )}
                </Row>
              )
            })}
          </Line>
        ))}
      </Lines>
      {collapsed.hiddenCount ? (
        <ShowAllButton
          label={
            expanded
              ? t('maps.family.showFewer', 'Show fewer')
              : t('maps.family.showAll', {
                  defaultValue: 'Show all {{count}}',
                  count: members.length,
                })
          }
          iconEnd={<MaterialIcon icon={expanded ? 'expand_less' : 'expand_more'} />}
          onClick={() => setExpanded(!expanded)}
        />
      ) : null}
    </>
  )
}

/** What the versions card's info icon says about the words it uses. */
export function useFamilyExplanation(): string {
  const { t } = useTranslation()
  return t(
    'maps.family.explanation',
    'Latest is the version most people play. Copies are the same version with small changes, ' +
      'like an observer, tournament or translated edit. Maps based on another one are different ' +
      'maps made from it.',
  )
}

/**
 * The map's versions, their copies and the maps based on it, one group per map, and for reviewers
 * a way to the maps detection found related to it that nobody has sorted yet.
 */
export function MapFamilyCard({
  map: mapRef,
}: {
  map: FragmentType<typeof MapPage_FamilyFragment>
}) {
  const { t } = useTranslation()
  const map = useFragment(MapPage_FamilyFragment, mapRef)
  const canManageMaps = useHasAnyPermission('manageMaps')
  const canReviewFamilies = useHasAnyPermission('reviewMapFamilies')
  const explanation = useFamilyExplanation()

  const members = map.family?.members ?? []
  const showLines = members.length >= 2
  const canReview = canManageMaps || (canReviewFamilies && map.listed)
  const reviewCount = canReview ? map.similarMaps.length : 0
  if (!showLines && !reviewCount) {
    return null
  }

  return (
    <FamilyCard>
      <CardHeader>
        <SectionLabel>{t('maps.family.title', 'Versions')}</SectionLabel>
        {showLines ? (
          <Tooltip text={explanation} position='right'>
            <InfoIcon />
          </Tooltip>
        ) : null}
      </CardHeader>
      {showLines ? (
        <FamilyVersionsList
          hereId={map.id}
          members={members.map(m => ({
            mapId: m.mapId,
            parentId: m.parentId ?? undefined,
            relation: m.relation,
            versionLabel: m.versionLabel ?? undefined,
            isCurrent: m.isCurrent,
            status: m.map.versionStatus,
            name: m.map.name,
            games: m.map.stats?.gamesTotal ?? 0,
            firstSeenAt: m.map.firstSeenAt,
          }))}
        />
      ) : null}
      {reviewCount ? (
        <ReviewPrompt>
          {t('maps.family.waitingForReview', {
            defaultValue: '{{count}} possibly related maps are waiting for review.',
            defaultValue_one: '{{count}} possibly related map is waiting for review.',
            count: reviewCount,
          })}{' '}
          <Link href={urlPath`/admin/map-families/maps/${map.id}`}>
            {t('maps.family.review', 'Review')}
          </Link>
        </ReviewPrompt>
      ) : null}
    </FamilyCard>
  )
}
