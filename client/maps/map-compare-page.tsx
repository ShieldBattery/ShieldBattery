import { TFunction } from 'i18next'
import * as React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { useRoute } from 'wouter'
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
import { useOverflowingElement } from '../dom/overflowing-element'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapChange, MapStartLocationChangeKind } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { IconButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Card } from '../material/card'
import { CheckBox } from '../material/check-box'
import { LinkButton } from '../material/link-button'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { SegmentedButtonGroup } from '../material/segmented-button'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { replace } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { LoadingDotsArea } from '../progress/dots'
import { useMultiplexRef } from '../react/refs'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  singleLine,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import {
  MapComparePicker,
  MapComparePicker_FamilyFragment,
  MapComparePicker_FileFragment,
} from './map-compare-picker'
import { compareViewportHeight, isPixelView, MapCompareViewer } from './map-compare-viewer'
import { urlForMapFile, useFamilyFileLabel } from './map-family-files'
import { MapReportBar } from './map-report-bar'
import { MapTileSource, useMapTileSource } from './map-tile-source'
import {
  FloatingZoomControls,
  MapImageBox,
  MapViewImage,
  useViewTransform,
  Viewport,
  ZoomControls,
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
 * under their own title.
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
 * The main area, and the right column beside it when there is one. Collapsed into one column, the
 * right column goes below the main area.
 */
const Columns = styled.div<{ $hasSide: boolean }>`
  display: grid;
  grid-template-columns: ${props => (props.$hasSide ? 'minmax(0, 1fr) 300px' : 'minmax(0, 1fr)')};
  align-items: start;
  gap: 24px;

  @media (max-width: ${COLLAPSE_WIDTH}) {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
`

const MainArea = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SideColumn = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
`

/** The pane headers and the panes they describe. */
const PaneStack = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

/** The headers of the two panes, with the swap button between them. */
const PaneHeaders = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
`

const HeaderCell = styled.div<{ $align: 'start' | 'end' }>`
  min-width: 0;

  display: flex;
  justify-content: ${props => (props.$align === 'start' ? 'flex-start' : 'flex-end')};
`

const SwapCell = styled.div`
  grid-column: 2;
`

/** A map's header: the button that changes the map, and the link to the map's page. */
const MapHeaderRoot = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 4px;
`

/** The page link keeps its size, so only the name gives up room when there's too little. */
const OpenPageTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

const MapHeaderButton = styled.button`
  ${buttonReset};
  height: 40px;
  min-width: 0;
  padding: 0 8px 0 12px;

  display: flex;
  align-items: center;
  gap: 4px;

  border-radius: 6px;
  color: var(--theme-on-surface);

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }
`

const MapHeaderName = styled.span`
  ${titleMedium};
  ${singleLine};
  min-width: 0;
`

const MapHeaderIcon = styled(MaterialIcon)`
  flex-shrink: 0;
`

const PopoverPicker = styled.div`
  width: min(440px, calc(100vw - 32px));
  max-height: min(560px, 70vh);
  padding: 12px;

  display: flex;
  flex-direction: column;
`

/** Two equal panes side by side, stacking in one column on narrow screens. */
const Panes = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 600px) {
    grid-template-columns: minmax(0, 1fr);
  }
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
  ${compareViewportHeight};
  min-width: 0;
  padding: 12px;

  display: flex;
  flex-direction: column;
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
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
`

const ControlsZoom = styled(ZoomControls)`
  flex-shrink: 0;
  margin-left: auto;
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
  align-items: flex-start;
  gap: 8px;
`

const ChangeText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

/** Sits at the row's end without making the row taller than its text. */
const ChangeAction = styled.div`
  flex-shrink: 0;
  margin: -8px -8px -8px 0;
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
  flex: 1 1 240px;
  min-width: 0;
  color: var(--theme-on-surface-variant);
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
  const showCompare = useShowCompare()
  const viewTransform = useViewTransform()
  const [viewParam, setViewParam] = useLocationSearchParam('view')
  const [showSpawns, setShowSpawns] = useState(true)
  const [showTerrainChanges, setShowTerrainChanges] = useState(false)
  const swapLabel = t('maps.compare.swap', 'Swap sides')

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

  const terrainToggleLabel = showTerrainChanges
    ? t('maps.compare.hideOnMap', 'Hide on the map')
    : t('maps.compare.showOnMap', 'Show on the map')
  const terrainToggle = terrainChanges ? (
    <Tooltip text={terrainToggleLabel} position='bottom' tabIndex={-1}>
      <IconButton
        icon={<MaterialIcon icon={showTerrainChanges ? 'visibility' : 'visibility_off'} />}
        ariaLabel={terrainToggleLabel}
        ariaPressed={showTerrainChanges}
        onClick={() => setShowTerrainChanges(!showTerrainChanges)}
      />
    </Tooltip>
  ) : undefined

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
        {sameSize ? null : (
          <NoteText>
            {t(
              'maps.compare.differentSizes',
              'These maps are different sizes, so they line up at the top left and the pixel views ' +
                "aren't available.",
            )}
          </NoteText>
        )}
        <ControlsZoom view={viewTransform} />
      </Controls>
      <PaneStack>
        <PaneHeaders>
          <HeaderCell $align='start'>
            <MapHeader side={a} other={b} align='start' onPick={id => showCompare(id, b.id)} />
          </HeaderCell>
          <SwapCell>
            <Tooltip text={swapLabel} position='bottom' tabIndex={-1}>
              <IconButton
                icon={<MaterialIcon icon='swap_horiz' />}
                ariaLabel={swapLabel}
                onClick={() => showCompare(b.id, a.id)}
              />
            </Tooltip>
          </SwapCell>
          <HeaderCell $align='end'>
            <MapHeader side={b} other={a} align='end' onPick={id => showCompare(a.id, id)} />
          </HeaderCell>
        </PaneHeaders>
        <MapCompareViewer
          view={view}
          before={compareImage(a, aTiles)}
          after={compareImage(b, bTiles)}
          terrainChanges={terrainChanges}
          showTerrainChanges={showTerrainChanges}
          showSpawns={showSpawns && !isPixelView(view)}
          viewTransform={viewTransform}
        />
      </PaneStack>
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
                <ChangeItem
                  key={c.key}
                  entry={c}
                  action={c.key === MapChange.Terrain ? terrainToggle : undefined}
                />
              ))}
            </ChangeList>
          ) : (
            <EmptyText>
              {t('maps.compare.noGameplayChanges', 'No changes to terrain, bases or spawns found.')}
            </EmptyText>
          )}
          {technical.length ? (
            <>
              <SectionTitle>{t('maps.compare.otherChanges', 'Other changes')}</SectionTitle>
              <ChangeList>
                {technical.map(c => (
                  <ChangeItem key={c.key} entry={c} />
                ))}
              </ChangeList>
            </>
          ) : null}
        </ChangesCard>
      }
    />
  )
}

/**
 * The layout every state of the page shares: the title (with the copy link button once both sides
 * have a map), then the main area, beside the right column when there's a `side` for it.
 */
function CompareLayout({
  a,
  b,
  view,
  main,
  side,
}: {
  a?: CompareSide
  b?: CompareSide
  view?: MapCompareView
  main: React.ReactNode
  side?: React.ReactNode
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
      <Columns $hasSide={!!side}>
        <MainArea>{main}</MainArea>
        {side ? <SideColumn>{side}</SideColumn> : null}
      </Columns>
    </>
  )
}

/**
 * The header of the pane showing one side's map: a button with the file's name that opens a
 * picker to change the map (which also offers the map's other files), and a link to the map's page.
 * With `align` `'end'` the picker opens with its right edge at the button's.
 */
function MapHeader({
  side,
  other,
  align,
  onPick,
}: {
  side: CompareSide
  /** The map on the other side, if it has one. */
  other?: CompareSide
  align: 'start' | 'end'
  onPick: (fileId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const file = useFragment(MapComparePicker_FileFragment, side)
  const family = useFragment(MapComparePicker_FamilyFragment, side.family)
  const familyFiles = useFragment(MapComparePicker_FileFragment, family.files)
  // An unlisted file only some viewers can see may not be among the map's files
  const files = familyFiles.some(f => f.id === side.id) ? familyFiles : [...familyFiles, file]
  const fileLabel = useFamilyFileLabel(files)
  const anchorOrigin = align === 'start' ? 'left' : 'right'
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    anchorOrigin,
    'bottom',
  )
  const [open, openPicker, closePicker] = usePopoverController({ refreshAnchorPos })
  const openPageLabel = t('maps.compare.openMapPage', 'Open map page')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const buttonMultiRef = useMultiplexRef(anchorRef, buttonRef)
  const [nameRef, nameOverflowing] = useOverflowingElement<HTMLSpanElement>()
  const label = fileLabel(file)

  return (
    <>
      <MapHeaderRoot>
        {/* The picker opens below the button, where the tooltip would cover it */}
        <Tooltip text={label} position='bottom' tabIndex={-1} disabled={!nameOverflowing || open}>
          <MapHeaderButton
            ref={buttonMultiRef}
            type='button'
            aria-haspopup='dialog'
            aria-expanded={open}
            onClick={openPicker}>
            <MapHeaderName ref={nameRef}>{label}</MapHeaderName>
            <MapHeaderIcon icon='arrow_drop_down' />
          </MapHeaderButton>
        </Tooltip>
        <OpenPageTooltip text={openPageLabel} position='bottom' tabIndex={-1}>
          <LinkButton href={urlForMapFile(family, side.id)} aria-label={openPageLabel}>
            <IconButton styledAs='div' icon={<MaterialIcon icon='open_in_new' />} />
          </LinkButton>
        </OpenPageTooltip>
      </MapHeaderRoot>
      <Popover
        open={open}
        onDismiss={() => {
          closePicker()
          buttonRef.current?.focus()
        }}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX={anchorOrigin}
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
      main={
        <PaneStack>
          <PaneHeaders>
            <HeaderCell $align='start'>
              <MapHeader side={side} align='start' onPick={id => showCompare(id)} />
            </HeaderCell>
          </PaneHeaders>
          <Panes>
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
            <PickerCard>
              <MapComparePicker
                other={{ file: side, family: side.family }}
                autoFocus={true}
                onPick={fileId => showCompare(side.id, fileId)}
              />
            </PickerCard>
          </Panes>
        </PaneStack>
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
      main={
        <Panes>
          <PickerCard>
            <MapComparePicker autoFocus={true} onPick={fileId => showCompare(fileId)} />
          </PickerCard>
          <EmptyViewer>
            <EmptyText>{t('maps.compare.chooseTwo', 'Choose two maps to compare')}</EmptyText>
          </EmptyViewer>
        </Panes>
      }
    />
  )
}

function ChangeItem({ entry, action }: { entry: ChangeEntry; action?: React.ReactNode }) {
  return (
    <ChangeRow>
      <ChangeText>
        <ChangeLabel>{entry.label}</ChangeLabel>
        {entry.lines.map((line, i) => (
          <ChangeDetail key={i}>{line}</ChangeDetail>
        ))}
      </ChangeText>
      {action ? <ChangeAction>{action}</ChangeAction> : null}
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
