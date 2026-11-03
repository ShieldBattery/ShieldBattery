import { TFunction } from 'i18next'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { useRoute } from 'wouter'
import {
  ALL_MAP_COMPARE_VIEWS,
  MAP_COMPARE_SEGMENT,
  MapCompareView,
  mapIdFromRouteSegment,
  urlForMap,
  urlForMapCompare,
} from '../../common/map-url'
import { filterColorCodes, SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { useTrackPageView } from '../analytics/analytics'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapChange, MapStartLocationChangeKind } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { IconButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { CheckBox } from '../material/check-box'
import { SegmentedButtonGroup } from '../material/segmented-button'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { CenteredContentContainer } from '../styles/centered-container'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { MapBackButton } from './map-back-button'
import { isPixelView, MapCompareViewer } from './map-compare-viewer'

const MapCompareQuery = graphql(/* GraphQL */ `
  query MapCompare($a: SbMapId!, $b: SbMapId!) {
    mapComparison(a: $a, b: $b) {
      id
      changes
      terrainSimilarity
      terrainChanges
      startLocations {
        id
        slot
        kind
      }
      bases {
        id
        beforeIndex
        afterIndex
        changed
      }
      a {
        id
        ...MapCompare_Side
      }
      b {
        id
        ...MapCompare_Side
      }
    }
  }
`)

const MapCompareSideFragment = graphql(/* GraphQL */ `
  fragment MapCompare_Side on SbMap {
    id
    name
    playerCount
    file {
      id
      tileset
      width
      height
      isEud
      image2048Url
      imageSpawnsBaked
      umsContent
      startLocations {
        id
        slot
        x
        y
      }
      analysis {
        id
        triggerCount
        umsActionKinds
      }
    }
  }
`)

/**
 * Requests results without suspending: the page renders its own loading state instead. Module-level so
 * the query sees the same context every render (a new object would make it start over).
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

type CompareSide = ReturnType<typeof useCompareSide>

function useCompareSide(ref: FragmentType<typeof MapCompareSideFragment>) {
  return useFragment(MapCompareSideFragment, ref)
}

interface ChangeEntry {
  key: string
  label: string
  lines: string[]
}

interface ComparisonDetails {
  changes: ReadonlyArray<MapChange>
  terrainSimilarity?: number | null
  startLocations: ReadonlyArray<{ slot: number; kind: MapStartLocationChangeKind }>
  bases: ReadonlyArray<{
    beforeIndex?: number | null
    afterIndex?: number | null
    changed: boolean
  }>
}

/**
 * Changes that matter to how the map plays, most important first. The rest are listed apart,
 * collapsed.
 */
const GAMEPLAY_CHANGES: ReadonlyArray<MapChange> = [
  MapChange.StartLocations,
  MapChange.Bases,
  MapChange.Terrain,
  MapChange.Dimensions,
  MapChange.Tileset,
  MapChange.PlayerCount,
  MapChange.Forces,
]

function beforeAfter(t: TFunction, before: string | number, after: string | number) {
  return t('maps.compare.beforeAfter', {
    defaultValue: '{{before}} → {{after}}',
    before,
    after,
  })
}

function yesNo(t: TFunction, value: boolean) {
  return value ? t('maps.compare.yes', 'Yes') : t('maps.compare.no', 'No')
}

/**
 * Rounds a 0-1 share to a whole percent, but never shows 0% or 100% for a share that isn't
 * exactly that.
 */
function formatPercent(share: number): number {
  const percent = Math.round(share * 100)
  if (share < 1 && percent >= 100) {
    return 99
  }
  if (share > 0 && percent <= 0) {
    return 1
  }
  return percent
}

function terrainSimilarityText(t: TFunction, similarity: number) {
  return t('maps.compare.terrainSimilarity', {
    defaultValue: '{{percent}}% of the walkable terrain is the same',
    percent: formatPercent(similarity),
  })
}

function describeChange(
  t: TFunction,
  change: MapChange,
  a: CompareSide,
  b: CompareSide,
  comparison: ComparisonDetails,
): ChangeEntry {
  switch (change) {
    case MapChange.Name:
      return {
        key: change,
        label: t('maps.compare.name', 'Name'),
        lines: [beforeAfter(t, filterColorCodes(a.name), filterColorCodes(b.name))],
      }
    case MapChange.Description:
      return {
        key: change,
        label: t('maps.compare.descriptionChanged', 'Description changed'),
        lines: [],
      }
    case MapChange.Dimensions:
      return {
        key: change,
        label: t('maps.compare.dimensions', 'Dimensions'),
        lines: [
          beforeAfter(t, `${a.file.width}×${a.file.height}`, `${b.file.width}×${b.file.height}`),
        ],
      }
    case MapChange.Tileset:
      return {
        key: change,
        label: t('maps.compare.tileset', 'Tileset'),
        lines: [
          beforeAfter(
            t,
            tilesetToName(a.file.tileset as Tileset, t),
            tilesetToName(b.file.tileset as Tileset, t),
          ),
        ],
      }
    case MapChange.PlayerCount:
      return {
        key: change,
        label: t('maps.compare.playerCount', 'Player slots'),
        lines: [beforeAfter(t, a.playerCount, b.playerCount)],
      }
    case MapChange.Forces:
      return {
        key: change,
        label: t('maps.compare.forcesChanged', 'Forces changed'),
        lines: [],
      }
    case MapChange.Eud:
      return {
        key: change,
        label: t('maps.compare.eud', 'Uses EUDs'),
        lines: [beforeAfter(t, yesNo(t, a.file.isEud), yesNo(t, b.file.isEud))],
      }
    case MapChange.UmsActions: {
      const before = new Set(a.file.analysis?.umsActionKinds ?? [])
      const after = new Set(b.file.analysis?.umsActionKinds ?? [])
      const added = Array.from(after).filter(k => !before.has(k))
      const removed = Array.from(before).filter(k => !after.has(k))
      const lines: string[] = []
      if (added.length) {
        lines.push(
          t('maps.compare.umsActionsAdded', {
            defaultValue: 'Added: {{actions}}',
            actions: added.join(', '),
          }),
        )
      }
      if (removed.length) {
        lines.push(
          t('maps.compare.umsActionsRemoved', {
            defaultValue: 'Removed: {{actions}}',
            actions: removed.join(', '),
          }),
        )
      }
      return { key: change, label: t('maps.compare.umsActions', 'Trigger actions'), lines }
    }
    case MapChange.TriggerCount:
      return {
        key: change,
        label: t('maps.compare.triggerCount', 'Trigger count'),
        lines: [
          beforeAfter(t, a.file.analysis?.triggerCount ?? 0, b.file.analysis?.triggerCount ?? 0),
        ],
      }
    case MapChange.StartLocations:
      return {
        key: change,
        label: t('maps.compare.startLocations', 'Start locations'),
        lines: comparison.startLocations.map(s => {
          const player = s.slot + 1
          switch (s.kind) {
            case MapStartLocationChangeKind.Moved:
              return t('maps.compare.startMoved', {
                defaultValue: 'Player {{player}} start moved',
                player,
              })
            case MapStartLocationChangeKind.Added:
              return t('maps.compare.startAdded', {
                defaultValue: 'Player {{player}} start added',
                player,
              })
            case MapStartLocationChangeKind.Removed:
              return t('maps.compare.startRemoved', {
                defaultValue: 'Player {{player}} start removed',
                player,
              })
            default:
              return s.kind satisfies never
          }
        }),
      }
    case MapChange.Bases: {
      const added = comparison.bases.filter(x => x.beforeIndex == null).length
      const removed = comparison.bases.filter(x => x.afterIndex == null).length
      const changed = comparison.bases.filter(
        x => x.beforeIndex != null && x.afterIndex != null && x.changed,
      ).length
      const parts: string[] = []
      if (changed) {
        parts.push(
          t('maps.compare.basesChanged', { defaultValue: '{{count}} changed', count: changed }),
        )
      }
      if (added) {
        parts.push(t('maps.compare.basesAdded', { defaultValue: '{{count}} added', count: added }))
      }
      if (removed) {
        parts.push(
          t('maps.compare.basesRemoved', { defaultValue: '{{count}} removed', count: removed }),
        )
      }
      return {
        key: change,
        label: t('maps.compare.bases', 'Resource bases'),
        lines: parts.length ? [parts.join(', ')] : [],
      }
    }
    case MapChange.Terrain:
      return {
        key: change,
        label: t('maps.compare.terrainChanged', 'Terrain shape changed'),
        lines:
          comparison.terrainSimilarity != null
            ? [terrainSimilarityText(t, comparison.terrainSimilarity)]
            : [],
      }
    default:
      return { key: change, label: change satisfies never, lines: [] }
  }
}

const NotFoundText = styled.div`
  ${bodyLarge};
  padding: 32px 16px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

/** The route for the compare page: `/maps/compare/:a/:b`. */
export function MapComparePageRoute() {
  const { t } = useTranslation()
  const [match, params] = useRoute(`/maps/${MAP_COMPARE_SEGMENT}/:a/:b`)
  useTrackPageView(`/maps/${MAP_COMPARE_SEGMENT}`)

  const a = match ? mapIdFromRouteSegment(params.a) : undefined
  const b = match ? mapIdFromRouteSegment(params.b) : undefined
  if (!a || !b) {
    return (
      <CenteredContentContainer>
        <NotFoundText>{t('maps.compare.notFound', 'These maps could not be found.')}</NotFoundText>
      </CenteredContentContainer>
    )
  }

  return <MapComparePage key={`${a}:${b}`} a={a} b={b} />
}

const PageContent = styled.div`
  padding-block: 16px 48px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const BackRow = styled.div`
  align-self: flex-start;
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
`

const Title = styled.h1`
  ${titleLarge};
  margin: 0;
`

const Names = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`

const NameLink = styled.a`
  ${titleSmall};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  align-items: start;
  gap: 24px;

  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const ChangesCard = styled(Card)`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionTitle = styled.h2`
  ${titleSmall};
  margin: 0;
`

const ChangeList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const ChangeRow = styled.li`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ChangeLabel = styled.div`
  ${labelLarge};
`

const ChangeDetail = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const EmptyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const NoteText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const TechnicalToggle = styled(TextButton)`
  align-self: flex-start;
  margin-inline-start: -12px;
`

function viewLabel(t: TFunction, view: MapCompareView): string {
  switch (view) {
    case MapCompareView.Split:
      return t('maps.compare.viewSplit', 'Split')
    case MapCompareView.Slider:
      return t('maps.compare.viewSlider', 'Slider')
    case MapCompareView.Fade:
      return t('maps.compare.viewFade', 'Fade')
    case MapCompareView.Flicker:
      return t('maps.compare.viewFlicker', 'Flicker')
    case MapCompareView.Highlight:
      return t('maps.compare.viewHighlight', 'Highlight')
    case MapCompareView.Subtract:
      return t('maps.compare.viewSubtract', 'Subtract')
    default:
      return view satisfies never
  }
}

/** Compares map `a` (the before side) with map `b` (the after side). */
function MapComparePage({ a, b }: { a: SbMapId; b: SbMapId }) {
  const { t } = useTranslation()
  const [{ data, error }, reexecuteQuery] = useQuery({
    query: MapCompareQuery,
    variables: { a, b },
    context: NO_SUSPENSE_CONTEXT,
  })

  const comparison = data?.mapComparison
  let content: React.ReactNode
  if (comparison) {
    content = (
      <CompareBody
        a={comparison.a}
        b={comparison.b}
        details={comparison}
        terrainChanges={comparison.terrainChanges ?? undefined}
      />
    )
  } else if (error) {
    content = (
      <NotFoundText>
        <LoadErrorRow
          message={t('maps.compare.loadError', "Couldn't compare these maps.")}
          onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
        />
      </NotFoundText>
    )
  } else if (data) {
    content = (
      <NotFoundText>{t('maps.compare.notFound', 'These maps could not be found.')}</NotFoundText>
    )
  } else {
    content = <LoadingDotsArea />
  }

  return (
    <CenteredContentContainer $fullWidth={true} data-content-fullbleed=''>
      <PageContent>
        <BackRow>
          <MapBackButton />
        </BackRow>
        {content}
      </PageContent>
    </CenteredContentContainer>
  )
}

function CompareBody({
  a: aRef,
  b: bRef,
  details,
  terrainChanges,
}: {
  a: FragmentType<typeof MapCompareSideFragment>
  b: FragmentType<typeof MapCompareSideFragment>
  details: ComparisonDetails
  terrainChanges?: string
}) {
  const { t } = useTranslation()
  const a = useCompareSide(aRef)
  const b = useCompareSide(bRef)
  const [viewParam, setViewParam] = useLocationSearchParam('view')
  const [showSpawns, setShowSpawns] = useState(true)
  const [showTerrainChanges, setShowTerrainChanges] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)

  const aName = filterColorCodes(a.name)
  const bName = filterColorCodes(b.name)
  const sameSize = a.file.width === b.file.width && a.file.height === b.file.height
  const views = ALL_MAP_COMPARE_VIEWS.filter(v => sameSize || !isPixelView(v))
  const requestedView = ALL_MAP_COMPARE_VIEWS.find(v => v === viewParam) ?? MapCompareView.Split
  const view = views.includes(requestedView) ? requestedView : MapCompareView.Split

  const gameplay = GAMEPLAY_CHANGES.filter(c => details.changes.includes(c)).map(c =>
    describeChange(t, c, a, b, details),
  )
  const technical = details.changes
    .filter(c => !GAMEPLAY_CHANGES.includes(c))
    .map(c => describeChange(t, c, a, b, details))

  const swapLabel = t('maps.compare.swap', 'Swap sides')

  return (
    <>
      <Header>
        <Title>{t('maps.compare.title', 'Compare maps')}</Title>
        <Names>
          <NameLink href={urlForMap(a.id, a.name)} title={aName}>
            {aName}
          </NameLink>
          <Tooltip text={swapLabel} position='bottom' tabIndex={-1}>
            <IconButton
              icon={<MaterialIcon icon='swap_horiz' />}
              ariaLabel={swapLabel}
              onClick={() => replace(urlForMapCompare(b.id, a.id, view))}
            />
          </Tooltip>
          <NameLink href={urlForMap(b.id, b.name)} title={bName}>
            {bName}
          </NameLink>
        </Names>
      </Header>

      <Controls>
        <SegmentedButtonGroup
          ariaLabel={t('maps.compare.view', 'How to compare')}
          segments={views.map(v => ({ value: v, label: viewLabel(t, v) }))}
          value={view}
          onChange={v => setViewParam(v === MapCompareView.Split ? '' : v)}
        />
        <CheckBox
          label={t('maps.compare.showSpawns', 'Start locations')}
          checked={showSpawns}
          disabled={isPixelView(view)}
          onChange={event => setShowSpawns(event.target.checked)}
        />
        {terrainChanges ? (
          <CheckBox
            label={t('maps.compare.showTerrainChanges', 'Show terrain shape changes')}
            checked={showTerrainChanges}
            onChange={event => setShowTerrainChanges(event.target.checked)}
          />
        ) : null}
        {sameSize ? null : (
          <NoteText>
            {t(
              'maps.compare.differentSizes',
              'These maps are different sizes, so they line up at the top left and the pixel views ' +
                "aren't available.",
            )}
          </NoteText>
        )}
      </Controls>

      <Columns>
        <MapCompareViewer
          view={view}
          before={compareImage(a)}
          after={compareImage(b)}
          terrainChanges={terrainChanges}
          showTerrainChanges={showTerrainChanges}
          showSpawns={showSpawns && !isPixelView(view)}
        />

        <ChangesCard>
          <SectionTitle>{t('maps.compare.gameplayChanges', 'Gameplay changes')}</SectionTitle>
          {gameplay.length ? (
            <ChangeList>
              {gameplay.map(c => (
                <ChangeItem key={c.key} entry={c} />
              ))}
            </ChangeList>
          ) : (
            <EmptyText>
              {t('maps.compare.noGameplayChanges', 'No changes to terrain, bases or spawns found.')}
            </EmptyText>
          )}
          {technical.length ? (
            <>
              <TechnicalToggle
                label={
                  showTechnical
                    ? t('maps.compare.hideTechnical', 'Hide other changes')
                    : t('maps.compare.showTechnical', {
                        defaultValue: 'Show {{count}} other changes',
                        defaultValue_one: 'Show {{count}} other change',
                        count: technical.length,
                      })
                }
                iconEnd={showTechnical ? 'expand_less' : 'expand_more'}
                onClick={() => setShowTechnical(!showTechnical)}
              />
              {showTechnical ? (
                <ChangeList>
                  {technical.map(c => (
                    <ChangeItem key={c.key} entry={c} />
                  ))}
                </ChangeList>
              ) : null}
            </>
          ) : null}
        </ChangesCard>
      </Columns>
    </>
  )
}

function ChangeItem({ entry }: { entry: ChangeEntry }) {
  return (
    <ChangeRow>
      <ChangeLabel>{entry.label}</ChangeLabel>
      {entry.lines.map((line, i) => (
        <ChangeDetail key={i}>{line}</ChangeDetail>
      ))}
    </ChangeRow>
  )
}

function compareImage(side: CompareSide) {
  const name = filterColorCodes(side.name)
  return {
    name,
    imageUrl: side.file.image2048Url,
    width: side.file.width,
    height: side.file.height,
    imageInfo: {
      name,
      imageSpawnsBaked: side.file.imageSpawnsBaked,
      mapData: {
        width: side.file.width,
        height: side.file.height,
        startLocations: side.file.startLocations,
        umsContent: side.file.umsContent ?? undefined,
      },
    },
  }
}
