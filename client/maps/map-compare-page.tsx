import { TFunction } from 'i18next'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { Link, useRoute } from 'wouter'
import {
  ALL_MAP_COMPARE_VIEWS,
  MAP_COMPARE_SEGMENT,
  MAP_REPORT_PARAM,
  MapCompareView,
  mapFileIdFromSegment,
  urlForMapCompare,
} from '../../common/map-url'
import { filterColorCodes, SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useTrackPageView } from '../analytics/analytics'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapChange, MapStartLocationChangeKind } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { IconButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { CheckBox } from '../material/check-box'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { SegmentedButtonGroup } from '../material/segmented-button'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { replace } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  singleLine,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { MapBackButton } from './map-back-button'
import {
  MapComparePicker,
  MapComparePicker_FamilyFragment,
  MapComparePicker_FileFragment,
} from './map-compare-picker'
import { compareViewportHeight, isPixelView, MapCompareViewer } from './map-compare-viewer'
import { urlForMapFile, useFamilyFileLabel } from './map-family-files'
import { MapFileImage } from './map-image'
import { MapReportBar } from './map-report-bar'
import { MapTileSource, useMapTileSource } from './map-tile-source'
import {
  FloatingZoomControls,
  MapImageBox,
  MapViewImage,
  useViewTransform,
  Viewport,
} from './map-viewport'

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

const MapCompareSingleQuery = graphql(/* GraphQL */ `
  query MapCompareSingle($id: SbMapId!) {
    map(id: $id) {
      id
      ...MapCompare_Side
    }
  }
`)

const MapCompareSideFragment = graphql(/* GraphQL */ `
  fragment MapCompare_Side on SbMap {
    id
    name
    playerCount
    ...MapComparePicker_FileFragment
    family {
      id
      ...MapComparePicker_FamilyFragment
    }
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

/**
 * The route for the compare page: `/maps/compare/:a?/:b?`. Either map can be missing (a lone map is
 * always `a`), for the page to have it picked there.
 */
export function MapComparePageRoute() {
  const { t } = useTranslation()
  const [match, params] = useRoute(`/maps/${MAP_COMPARE_SEGMENT}/:a?/:b?`)
  useTrackPageView(`/maps/${MAP_COMPARE_SEGMENT}`)

  const a = match && params.a ? mapFileIdFromSegment(params.a) : undefined
  const b = match && params.b ? mapFileIdFromSegment(params.b) : undefined
  if (!match || (params.a && !a) || (params.b && !b)) {
    return (
      <CenteredContentContainer>
        <NotFoundText>{t('maps.compare.notFound', 'These maps could not be found.')}</NotFoundText>
      </CenteredContentContainer>
    )
  }

  return <MapComparePage a={a} b={b} />
}

/**
 * Returns a function that shows other maps on the compare page, keeping its view and the report it
 * reviews. It replaces the URL, so going back leaves the page rather than stepping through picks.
 */
function useShowCompare() {
  const [viewParam] = useLocationSearchParam('view')
  const [reportId] = useLocationSearchParam(MAP_REPORT_PARAM)
  const view = ALL_MAP_COMPARE_VIEWS.find(v => v === viewParam)
  return (a?: SbMapId, b?: SbMapId) => replace(urlForMapCompare(a, b, view, reportId || undefined))
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

const HeaderActions = styled.div`
  margin-left: auto;
`

/** The width at which the page's columns collapse into one. */
const COLLAPSE_WIDTH = '1100px'

/**
 * The main area and the right column. Collapsed into one column, the maps card comes first, then the
 * main area, then the rest of the right column.
 */
const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  align-items: start;
  gap: 24px;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
`

const MainArea = styled.div`
  grid-column: 1;
  grid-row: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 16px;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    grid-column: auto;
    grid-row: auto;
    order: 1;
  }
`

/**
 * The right column: the maps card, then the changes card or the picker. With `$fill`, it's as tall
 * as the compare viewer's viewports and the picker takes the height the maps card leaves.
 */
const SideColumn = styled.div<{ $fill: boolean }>`
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  ${props => (props.$fill ? compareViewportHeight : '')};

  display: flex;
  flex-direction: column;
  gap: 16px;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    display: contents;
  }
`

const MapsCard = styled(Card)`
  flex-shrink: 0;
  padding-block: 8px;

  display: flex;
  flex-direction: column;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    order: 0;
  }
`

/** Below the maps card, and below the main area when the columns are collapsed. */
const SideContent = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;

  display: flex;
  flex-direction: column;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    order: 2;
  }
`

const MapRowRoot = styled.div`
  min-width: 0;
  height: 56px;

  display: flex;
  align-items: center;
  gap: 12px;
`

const MapRowImage = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
`

const EmptyMapRowImage = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 1px dashed var(--theme-outline);
  border-radius: 4px;
`

/** The map's name, and below it the file's name when the map has more than one. */
const MapRowText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const MapRowName = styled(Link)`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
`

const MapRowFileName = styled.div`
  ${bodySmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface-variant);
`

const EmptyMapRowText = styled.div`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface-variant);
`

/** Holds the swap button, keeping its room while there's nothing to swap. */
const SwapRow = styled.div`
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;
`

const PopoverPicker = styled.div`
  width: min(400px, calc(100vw - 32px));
  max-height: min(480px, 70vh);
  padding: 12px;

  display: flex;
  flex-direction: column;
`

/** The lone map's viewport, with its zoom controls floating over it. */
const SingleViewer = styled.div`
  position: relative;
  min-width: 0;
`

const SingleViewport = styled(Viewport)`
  ${compareViewportHeight};
`

const PickerCard = styled(Card)`
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px;

  display: flex;
  flex-direction: column;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    max-height: 480px;
  }
`

/** Stands in for the viewer until there's a map to show. */
const EmptyViewer = styled.div`
  ${compareViewportHeight};
  padding: 16px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  background-color: var(--theme-container-lowest);
  text-align: center;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    height: 160px;
  }
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
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

/**
 * The compare page: compares map `a` (the before side) with map `b` (the after side), or shows the
 * one map it has and a picker for the other, or a picker for the first map.
 */
function MapComparePage({ a, b }: { a?: SbMapId; b?: SbMapId }) {
  const [reportId] = useLocationSearchParam(MAP_REPORT_PARAM)
  const canManageMaps = useHasAnyPermission('manageMaps')

  let content: React.ReactNode
  if (a && b) {
    content = <TwoMapCompare key={`${a}:${b}`} a={a} b={b} />
  } else if (a) {
    content = <OneMapCompare key={a} a={a} />
  } else {
    content = <NoMapCompare />
  }

  return (
    <CenteredContentContainer $fullWidth={true} data-content-fullbleed=''>
      <PageContent>
        <BackRow>
          <MapBackButton />
        </BackRow>
        {reportId && canManageMaps ? <MapReportBar reportId={reportId} /> : null}
        {content}
      </PageContent>
    </CenteredContentContainer>
  )
}

function TwoMapCompare({ a, b }: { a: SbMapId; b: SbMapId }) {
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

  return content
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
  const aTiles = useMapTileSource(a.id)
  const bTiles = useMapTileSource(b.id)
  const [viewParam, setViewParam] = useLocationSearchParam('view')
  const [showSpawns, setShowSpawns] = useState(true)
  const [showTerrainChanges, setShowTerrainChanges] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)

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

  const main = (
    <>
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
      <MapCompareViewer
        view={view}
        before={compareImage(a, aTiles)}
        after={compareImage(b, bTiles)}
        terrainChanges={terrainChanges}
        showTerrainChanges={showTerrainChanges}
        showSpawns={showSpawns && !isPixelView(view)}
      />
    </>
  )

  return (
    <CompareLayout
      a={a}
      b={b}
      view={view}
      main={main}
      side={
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
      }
    />
  )
}

/**
 * The layout every state of the page shares: the title (with the copy link button once both sides
 * have a map), then the main area beside a right column holding the maps card above `side`. With
 * `fillSide`, the right column is as tall as the compare viewer's viewports.
 */
function CompareLayout({
  a,
  b,
  view,
  main,
  side,
  fillSide = false,
}: {
  a?: CompareSide
  b?: CompareSide
  view?: MapCompareView
  main: React.ReactNode
  side: React.ReactNode
  fillSide?: boolean
}) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const copyLinkLabel = t('maps.page.copyLink', 'Copy link')

  const onCopyLink = () => {
    const url = new URL(makeServerUrl(urlForMapCompare(a?.id, b?.id, view)), location.origin)
    navigator.clipboard
      .writeText(url.toString())
      .then(() => snackbarController.showSnackbar(t('maps.page.linkCopied', 'Link copied')))
      .catch(() =>
        snackbarController.showSnackbar(t('maps.page.linkCopyError', "Couldn't copy the link")),
      )
  }

  return (
    <>
      <Header>
        <Title>{t('maps.compare.title', 'Compare maps')}</Title>
        {a && b ? (
          <HeaderActions>
            <Tooltip text={copyLinkLabel} position='bottom' tabIndex={-1}>
              <IconButton
                icon={<MaterialIcon icon='link' />}
                ariaLabel={copyLinkLabel}
                onClick={onCopyLink}
              />
            </Tooltip>
          </HeaderActions>
        ) : null}
      </Header>
      <Columns>
        <MainArea>{main}</MainArea>
        <SideColumn $fill={fillSide}>
          <ComparedMapsCard a={a} b={b} />
          <SideContent>{side}</SideContent>
        </SideColumn>
      </Columns>
    </>
  )
}

/**
 * The two sides' maps, the before side above the after side, with the swap button between them
 * once both have a map. A side without a map says that one is still to be chosen.
 */
function ComparedMapsCard({ a, b }: { a?: CompareSide; b?: CompareSide }) {
  const { t } = useTranslation()
  const showCompare = useShowCompare()
  const swapLabel = t('maps.compare.swap', 'Swap sides')

  return (
    <MapsCard>
      {a ? (
        <FilledMapRow side={a} other={b} onPick={id => showCompare(id, b?.id)} />
      ) : (
        <EmptyMapRow />
      )}
      <SwapRow>
        {a && b ? (
          <Tooltip text={swapLabel} position='left' tabIndex={-1}>
            <IconButton
              icon={<MaterialIcon icon='swap_vert' />}
              ariaLabel={swapLabel}
              onClick={() => showCompare(b.id, a.id)}
            />
          </Tooltip>
        ) : null}
      </SwapRow>
      {a && b ? (
        <FilledMapRow side={b} other={a} onPick={id => showCompare(a.id, id)} />
      ) : (
        <EmptyMapRow />
      )}
    </MapsCard>
  )
}

function EmptyMapRow() {
  const { t } = useTranslation()
  return (
    <MapRowRoot>
      <EmptyMapRowImage />
      <EmptyMapRowText>{t('maps.compare.chooseMap', 'Choose a map')}</EmptyMapRowText>
    </MapRowRoot>
  )
}

/**
 * One side's map: its image, the map's name linking to its page (with the file's name below when
 * the map has more than one file the viewer can see) and a button opening the picker to change it,
 * which also offers the map's other files.
 */
function FilledMapRow({
  side,
  other,
  onPick,
}: {
  side: CompareSide
  /** The map on the other side, if it has one. */
  other?: CompareSide
  onPick: (fileId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const file = useFragment(MapComparePicker_FileFragment, side)
  const family = useFragment(MapComparePicker_FamilyFragment, side.family)
  const familyFiles = useFragment(MapComparePicker_FileFragment, family.files)
  // An unlisted file only some viewers can see may not be among the map's files
  const files = familyFiles.some(f => f.id === side.id) ? familyFiles : [...familyFiles, file]
  const fileLabel = useFamilyFileLabel(files)
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [open, openPicker, closePicker] = usePopoverController({ refreshAnchorPos })
  const changeLabel = t('maps.compare.changeMap', 'Change map')

  return (
    <>
      <MapRowRoot ref={anchorRef}>
        <MapRowImage>
          <MapFileImage
            file={file.file}
            name={filterColorCodes(side.name)}
            size={64}
            forceAspectRatio={1}
          />
        </MapRowImage>
        <MapRowText>
          <MapRowName href={urlForMapFile(family, side.id)}>
            {filterColorCodes(family.name)}
          </MapRowName>
          {files.length > 1 ? <MapRowFileName>{fileLabel(file)}</MapRowFileName> : null}
        </MapRowText>
        {/* The picker opens below the row, where the tooltip would cover it */}
        <Tooltip text={changeLabel} position='left' tabIndex={-1} disabled={open}>
          <IconButton
            icon={<MaterialIcon icon='edit' />}
            ariaLabel={changeLabel}
            ariaExpanded={open}
            onClick={openPicker}
          />
        </Tooltip>
      </MapRowRoot>
      <Popover
        open={open}
        onDismiss={closePicker}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'
        // The search field takes focus when it shows
        focusOnMount={false}>
        <PopoverPicker>
          <MapComparePicker
            own={{ file: side, family: side.family }}
            other={other ? { file: other, family: other.family } : undefined}
            autoFocus={true}
            onPick={fileId => {
              closePicker()
              onPick(fileId)
            }}
          />
        </PopoverPicker>
      </Popover>
    </>
  )
}

/** The page with one map: the map alone, and the picker for the map to compare it with. */
function OneMapCompare({ a }: { a: SbMapId }) {
  const { t } = useTranslation()
  const [{ data, error }, reexecuteQuery] = useQuery({
    query: MapCompareSingleQuery,
    variables: { id: a },
    context: NO_SUSPENSE_CONTEXT,
  })

  if (data?.map) {
    return <OneMapBody side={data.map} />
  } else if (error) {
    return (
      <NotFoundText>
        <LoadErrorRow
          message={t('maps.compare.loadMapError', "Couldn't load this map.")}
          onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
        />
      </NotFoundText>
    )
  } else if (data) {
    return (
      <NotFoundText>{t('maps.compare.notFound', 'These maps could not be found.')}</NotFoundText>
    )
  } else {
    return <LoadingDotsArea />
  }
}

function OneMapBody({ side: sideRef }: { side: FragmentType<typeof MapCompareSideFragment> }) {
  const side = useCompareSide(sideRef)
  const tiles = useMapTileSource(side.id)
  const viewTransform = useViewTransform()
  const showCompare = useShowCompare()
  const image = compareImage(side, tiles)

  return (
    <CompareLayout
      a={side}
      fillSide={true}
      main={
        <SingleViewer>
          <SingleViewport
            transform={viewTransform.transform}
            onTransform={viewTransform.onTransform}
            onSize={viewTransform.onSize}
            tiles={{ width: image.width, height: image.height }}
            content={frame => <MapImageBox image={image} frame={frame} showSpawns={true} />}
          />
          <FloatingZoomControls view={viewTransform} />
        </SingleViewer>
      }
      side={
        <PickerCard>
          <MapComparePicker
            other={{ file: side, family: side.family }}
            autoFocus={true}
            onPick={fileId => showCompare(side.id, fileId)}
          />
        </PickerCard>
      }
    />
  )
}

/** The page with no map yet: the picker for the first map. */
function NoMapCompare() {
  const { t } = useTranslation()
  const showCompare = useShowCompare()

  return (
    <CompareLayout
      fillSide={true}
      main={
        <EmptyViewer>
          <EmptyText>{t('maps.compare.chooseTwo', 'Choose two maps to compare')}</EmptyText>
        </EmptyViewer>
      }
      side={
        <PickerCard>
          <MapComparePicker autoFocus={true} onPick={fileId => showCompare(fileId)} />
        </PickerCard>
      }
    />
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

function compareImage(side: CompareSide, tiles: MapTileSource | undefined): MapViewImage {
  const name = filterColorCodes(side.name)
  return {
    name,
    imageUrl: side.file.image2048Url,
    tiles,
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
