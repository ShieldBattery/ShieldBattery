import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { redirectToLogin, useIsLoggedIn } from '../auth/auth-utils'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapFamilyRelation, MapVersionStatus } from '../gql/graphql'
import { TransInterpolation } from '../i18n/i18next'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RoomChip, SectionLabel } from '../lobbies/room/room-parts'
import { IconButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Callout } from '../material/callout'
import { Card } from '../material/card'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { bodyMedium, bodySmall, singleLine, titleSmall } from '../styles/typography'
import { openMapCompareDialog, openMapFamilyLinkDialog } from './action-creators'
import { FamilyPlacement, orderTreeRows } from './family-editor'

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

/** Points from an older version of a map to the current one. */
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
        is the current one.
      </Trans>
    </Callout>
  )
}

const MapPage_FamilyFragment = graphql(/* GraphQL */ `
  fragment MapPage_FamilyFragment on SbMap {
    id
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
        lineCurrentId
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

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Row = styled.div<{ $depth: number }>`
  min-height: 40px;
  padding-left: ${props => props.$depth * 20}px;

  display: flex;
  align-items: center;
  gap: 4px;
`

const BranchIcon = styled(MaterialIcon).attrs({ icon: 'subdirectory_arrow_right', size: 16 })`
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 4px;
  color: var(--theme-on-surface-variant);
`

/** Lines a version up with the file it follows, which has a branch icon in front of it. */
const BranchSpacer = styled.div`
  width: 16px;
  flex-shrink: 0;
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

const SmallChip = styled(RoomChip)`
  flex-shrink: 0;
  padding: 2px 8px;
`

const CurrentChip = styled(SmallChip)`
  background-color: rgb(from var(--theme-positive) r g b / 0.16);
  color: var(--theme-positive);
`

const ForkChip = styled(SmallChip)`
  background-color: var(--theme-primary-container);
  color: var(--theme-on-primary-container);
`

const RowSubtitle = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const SimilarMaps = styled.div<{ $belowTree: boolean }>`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);

  ${props =>
    props.$belowTree
      ? `
        padding-top: 8px;
        border-top: 1px solid var(--theme-outline-variant);
      `
      : ''}
`

const InlineAction = styled.button.attrs({ type: 'button' })`
  ${buttonReset};
  ${bodyMedium};
  display: inline;
  margin: 0;
  padding: 0;
  color: var(--theme-primary);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: 2px;
  }
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

/**
 * The versions, variants, translations and forks of the map as a tree, and an invitation to sort
 * the maps detection found similar to it.
 */
export function MapFamilyCard({
  map: mapRef,
}: {
  map: FragmentType<typeof MapPage_FamilyFragment>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isLoggedIn = useIsLoggedIn()
  const map = useFragment(MapPage_FamilyFragment, mapRef)
  const numbers = useFormat(compactNumber)

  const members = map.family?.members ?? []
  const showTree = members.length >= 2
  const similarCount = map.similarMaps.length
  if (!showTree && !similarCount) {
    return null
  }

  const byId = new Map(members.map(m => [m.mapId, m]))
  const placements = new Map<SbMapId, FamilyPlacement>(
    members.map(m => [
      m.mapId,
      {
        kind: 'tree',
        parentId: m.parentId ?? undefined,
        relation: m.relation,
        versionLabel: m.versionLabel ?? '',
      },
    ]),
  )
  const rows = showTree
    ? orderTreeRows(
        members.map(m => ({ id: m.mapId, firstSeenAt: Date.parse(m.map.firstSeenAt) })),
        placements,
      )
    : []
  const lineSizes = new Map<SbMapId, number>()
  for (const m of members) {
    if (m.lineCurrentId) {
      lineSizes.set(m.lineCurrentId, (lineSizes.get(m.lineCurrentId) ?? 0) + 1)
    }
  }

  const statusText = (status: MapVersionStatus): string | undefined => {
    switch (status) {
      case MapVersionStatus.Superseded:
        return t('maps.family.statusSuperseded', 'older version')
      case MapVersionStatus.Variant:
        return t('maps.family.statusVariant', 'variant')
      case MapVersionStatus.Translation:
        return t('maps.family.statusTranslation', 'translation')
      default:
        return undefined
    }
  }

  const compareLabel = t('maps.family.compareWithThis', 'Compare with this map')

  return (
    <FamilyCard>
      <SectionLabel>{t('maps.family.title', 'Versions & forks')}</SectionLabel>
      {rows.length ? (
        <Rows>
          {rows.map(({ id, depth, branch }) => {
            const member = byId.get(id)!
            const isHere = member.mapId === map.id
            const name = memberName(member.map.name, member.versionLabel)
            const games = member.map.stats?.gamesTotal ?? 0
            const subtitle = [
              t('maps.family.games', {
                defaultValue: '{{formattedCount}} games',
                defaultValue_one: '{{formattedCount}} game',
                count: games,
                formattedCount: numbers.format(games),
              }),
              statusText(member.map.versionStatus),
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <Row key={id} $depth={depth}>
                {branch ? <BranchIcon /> : null}
                {depth > 0 && !branch ? <BranchSpacer /> : null}
                <RowText>
                  <RowTitle>
                    {isHere ? (
                      <MemberName title={name}>{name}</MemberName>
                    ) : (
                      <MemberLink href={urlForMap(member.mapId, member.map.name)} title={name}>
                        {name}
                      </MemberLink>
                    )}
                    {member.isCurrent && (lineSizes.get(member.mapId) ?? 0) > 1 ? (
                      <CurrentChip>{t('maps.family.current', 'Current')}</CurrentChip>
                    ) : null}
                    {member.relation === MapFamilyRelation.Fork ? (
                      <ForkChip>{t('maps.family.fork', 'Fork')}</ForkChip>
                    ) : null}
                  </RowTitle>
                  <RowSubtitle>{subtitle}</RowSubtitle>
                </RowText>
                {isHere ? null : (
                  <Tooltip text={compareLabel} position='left' tabIndex={-1}>
                    <IconButton
                      icon={<MaterialIcon icon='compare' />}
                      ariaLabel={compareLabel}
                      onClick={() =>
                        dispatch(openMapCompareDialog(...compareOrder(member.map, map)))
                      }
                    />
                  </Tooltip>
                )}
              </Row>
            )
          })}
        </Rows>
      ) : null}
      {similarCount ? (
        <SimilarMaps $belowTree={rows.length > 0}>
          {t('maps.family.similarMaps', {
            defaultValue: '{{count}} similar maps found. Know how they’re related?',
            defaultValue_one: '{{count}} similar map found. Know how it’s related?',
            count: similarCount,
          })}{' '}
          <InlineAction
            onClick={() => {
              if (isLoggedIn) {
                dispatch(openMapFamilyLinkDialog(map.id, 'related'))
              } else {
                redirectToLogin(push)
              }
            }}>
            {t('maps.family.helpSort', {
              defaultValue: 'Help sort them',
              defaultValue_one: 'Help sort it',
              count: similarCount,
            })}
          </InlineAction>
        </SimilarMaps>
      ) : null}
    </FamilyCard>
  )
}
