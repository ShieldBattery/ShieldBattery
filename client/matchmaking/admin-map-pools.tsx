import * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useClient, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { concatWithoutDuplicates } from '../../common/data-structures/arrays'
import { urlForMapCollection } from '../../common/map-url'
import { filterColorCodes, makeMapCollectionId, makeSbMapId, SbMapId } from '../../common/maps'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import {
  CreateMatchmakingMapPoolRequest,
  CreateMatchmakingMapPoolResponse,
  GetMatchmakingMapPoolsHistoryResponse,
  MatchmakingMapPoolJson,
} from '../../common/matchmaking/matchmaking-map-pools'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { graphql, useFragment } from '../gql'
import { longTimestamp } from '../i18n/date-formats'
import { dateTimeFormat, numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { orderFamilyFiles, urlForMapFile } from '../maps/map-family-files'
import { MapFileImage } from '../maps/map-image'
import {
  MapPicker,
  MapPickerCollectionTarget,
  MapPickerMode,
  useMapPickerSession,
} from '../maps/map-picker'
import {
  MapRow,
  MapRowChip,
  MapRowControlButton,
  MapRowControls,
  MapRowGamesCount,
  MapRowLink,
  MapRowMeta,
  MapRowName,
  MapRowNameLine,
  MapRowText,
  MapRowThumbnail,
} from '../maps/map-row-parts'
import { MapTile_SbMapFragment, mapTileMeta } from '../maps/map-tile'
import { useUploadMapFiles } from '../maps/map-uploads'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { DateTimeTextField } from '../material/datetime-text-field'
import { NumberTextField } from '../material/number-text-field'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useNow } from '../react/date-hooks'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { bodyLarge, bodyMedium, titleLarge, titleMedium, titleSmall } from '../styles/typography'
import { poolChangeSummary } from './admin-map-pool-changes'
import { MatchmakingTypeNav } from './matchmaking-type-nav'

function getMapPoolsHistory(
  type: MatchmakingType,
  offset: number,
  spec: RequestHandlingSpec<GetMatchmakingMapPoolsHistoryResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<GetMatchmakingMapPoolsHistoryResponse>(
      apiUrl`matchmaking-map-pools/${type}?offset=${offset}`,
      { signal: spec.signal },
    )
  })
}

function createMapPool(
  type: MatchmakingType,
  maps: ReadonlyArray<SbMapId>,
  maxVetoCount: number,
  startDate: number,
  spec: RequestHandlingSpec<CreateMatchmakingMapPoolResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<CreateMatchmakingMapPoolResponse>(
      apiUrl`matchmaking-map-pools/${type}`,
      {
        method: 'post',
        body: encodeBodyAsParams<CreateMatchmakingMapPoolRequest>({
          maps,
          maxVetoCount,
          startDate,
        }),
        signal: spec.signal,
      },
    )
  })
}

function deleteMapPool(id: number, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson(apiUrl`matchmaking-map-pools/${id}`, {
      method: 'delete',
      signal: spec.signal,
    })
  })
}

/** The text of a failed request: the server's own message when it sent one. */
function requestErrorText(err: Error): string {
  if (isFetchError(err)) {
    const body = err.body
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  }
  return err.message
}

/** Everything a pool's row (and a draft's row) shows about one of the pool's files. */
const AdminMapPoolRowQuery = graphql(/* GraphQL */ `
  query AdminMapPoolRow($id: SbMapId!) {
    map(id: $id) {
      id
      listed
      ...MapTile_SbMapFragment
      family {
        id
        name
        current {
          id
        }
        files {
          id
          name
          listed
          firstSeenAt
          stats {
            id
            gamesTotal
          }
        }
      }
    }
  }
`)

/** The ladder pools (as collections) that hold one of a map's files. */
const AdminMapPoolCollectionQuery = graphql(/* GraphQL */ `
  query AdminMapPoolCollection($id: SbMapId!) {
    map(id: $id) {
      id
      family {
        id
        ladderPools(first: 100) {
          id
          pool {
            id
          }
        }
      }
    }
  }
`)

/**
 * Requests results without suspending: the page renders its own loading states. Module-level so the
 * query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const dayFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })
const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

/** Newest first, the order the server pages them in. */
function sortPools(pools: ReadonlyArray<MatchmakingMapPoolJson>): MatchmakingMapPoolJson[] {
  return pools.toSorted((a, b) => b.startDate - a.startDate)
}

/**
 * Splits pools sorted newest first into those that haven't started (soonest first), the one that
 * plays now, and the ones before it (newest first).
 */
function groupPools(pools: ReadonlyArray<MatchmakingMapPoolJson>, now: number) {
  const started = pools.filter(p => p.startDate <= now)
  return {
    scheduled: pools.filter(p => p.startDate > now).reverse(),
    current: started.at(0),
    history: started.slice(1).map((pool, i) => ({ pool, endDate: started[i].startDate })),
  }
}

/** A new pool being put together, before it's scheduled. */
interface PoolDraft {
  /** Tells drafts apart, so a request made for one never changes a draft that replaced it. */
  id: number
  /** The pool it was based on, if any. */
  base?: MatchmakingMapPoolJson
  maps: ReadonlyArray<SbMapId>
  /** The map (family) each file is in, for the files it's known for. */
  families: ReadonlyMap<SbMapId, string>
  maxVetoCount: number
  /** A local date/time string, as the start date field takes it. */
  startDate: string
  /** Set once scheduling was tried, and kept up to date with each change from then on. */
  problems?: DraftProblems
  submitting: boolean
  /** Why scheduling it failed. */
  error?: string
}

interface DraftProblems {
  maps?: string
  maxVetoCount?: string
  startDate?: string
}

function draftProblems(draft: PoolDraft, now: number): DraftProblems | undefined {
  const problems: DraftProblems = {
    maps: draft.maps.length ? undefined : 'Add at least one map',
    maxVetoCount:
      Number.isInteger(draft.maxVetoCount) && draft.maxVetoCount >= 0
        ? undefined
        : 'Must be 0 or more',
    startDate:
      draft.startDate && Date.parse(draft.startDate) > now ? undefined : 'Must be in the future',
  }
  return problems.maps || problems.maxVetoCount || problems.startDate ? problems : undefined
}

const Root = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: row;

  overflow: hidden;
`

const AdminRail = styled.div`
  flex-shrink: 0;
  width: 224px;
  height: 100%;
  padding: 16px 12px;

  background-color: var(--theme-container-lowest);
  border-right: 1px solid rgb(from var(--color-blue80) r g b / 0.07);
  overflow-y: auto;
`

const Container = styled(CenteredContentContainer)`
  flex: 1 1 auto;
  min-width: 0;
  padding-block: 16px 8px;
`

const PickerRoot = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;

  display: flex;
  flex-direction: column;
`

const PageHeadline = styled.div`
  ${titleLarge};

  margin-block: 16px 8px;
`

const Content = styled.div`
  width: 100%;
  padding-bottom: 32px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ErrorText = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
  overflow-wrap: anywhere;
`

const SectionTitle = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface-variant);

  margin-top: 8px;
`

const EmptyState = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
`

const EmptyText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

export function AdminMatchmakingMapPools() {
  const [activeType, setActiveType] = useState<MatchmakingType>(MatchmakingType.Match1v1)

  // Recreated when the mode changes, which clears its state (and the state of its children)
  return <MapPoolsScreen key={activeType} type={activeType} onTypeChange={setActiveType} />
}

function MapPoolsScreen({
  type,
  onTypeChange,
}: {
  type: MatchmakingType
  onTypeChange: (type: MatchmakingType) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const client = useClient()
  const snackbarController = useSnackbarController()
  const now = useNow(10_000)

  const [pools, setPools] = useState<MatchmakingMapPoolJson[]>()
  const [hasMorePools, setHasMorePools] = useState(false)
  const [isLoadingPools, setIsLoadingPools] = useState(true)
  const [loadError, setLoadError] = useState<Error>()
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  const [draft, setDraft] = useState<PoolDraft>()
  const [picking, setPicking] = useState(false)
  const lastDraftId = useRef(0)

  const typeLabel = matchmakingTypeToLabel(type, t)

  const loadPools = (offset: number, signal?: AbortSignal) => {
    dispatch(
      getMapPoolsHistory(type, offset, {
        signal,
        onSuccess: data => {
          setPools(existing =>
            sortPools(concatWithoutDuplicates(existing ?? [], data.pools, p => p.id)),
          )
          setHasMorePools(data.hasMorePools)
          setIsLoadingPools(false)
          setLoadError(undefined)
        },
        onError: err => {
          setIsLoadingPools(false)
          setLoadError(err)
        },
      }),
    )
  }
  const loadFirstPools = useEffectEvent((signal: AbortSignal) => loadPools(0, signal))
  useEffect(() => {
    const abortController = new AbortController()
    loadFirstPools(abortController.signal)
    return () => abortController.abort()
  }, [])

  const loadMorePools = () => {
    setIsLoadingPools(true)
    setLoadError(undefined)
    loadPools(pools?.length ?? 0)
  }

  const startDraft = (base?: MatchmakingMapPoolJson) => {
    lastDraftId.current += 1
    const id = lastDraftId.current
    setDraft({
      id,
      base,
      maps: base?.maps ?? [],
      families: new Map(),
      maxVetoCount: base?.maxVetoCount ?? 0,
      startDate: '',
      submitting: false,
    })
    // The rows ask for the same data, so these share their requests
    for (const mapId of base?.maps ?? []) {
      client
        .query(AdminMapPoolRowQuery, { id: mapId })
        .toPromise()
        .then(result => {
          const familyId = result.data?.map?.family.id
          if (familyId) {
            setDraft(d =>
              d?.id === id ? { ...d, families: new Map(d.families).set(mapId, familyId) } : d,
            )
          }
        })
        .catch(swallowNonBuiltins)
    }
  }

  const changeDraft = (changes: Partial<PoolDraft>) => {
    if (!draft) {
      return
    }
    const next = { ...draft, ...changes }
    setDraft(next.problems ? { ...next, problems: draftProblems(next, Date.now()) } : next)
  }

  const swapFile = (from: SbMapId, to: SbMapId, familyId: string) => {
    if (!draft || draft.maps.includes(to)) {
      return
    }
    changeDraft({
      maps: draft.maps.map(id => (id === from ? to : id)),
      families: new Map(draft.families).set(to, familyId),
    })
  }

  const addToDraft = (mapId: SbMapId, familyId: string) => {
    setDraft(d => {
      if (!d || d.maps.includes(mapId) || d.maps.some(id => d.families.get(id) === familyId)) {
        return d
      }
      const next = {
        ...d,
        maps: [...d.maps, mapId],
        families: new Map(d.families).set(mapId, familyId),
      }
      return next.problems ? { ...next, problems: draftProblems(next, Date.now()) } : next
    })
  }

  const schedule = () => {
    if (!draft || draft.submitting) {
      return
    }
    const problems = draftProblems(draft, Date.now())
    if (problems) {
      setDraft({ ...draft, problems })
      return
    }

    const id = draft.id
    setDraft({ ...draft, problems: undefined, submitting: true, error: undefined })
    dispatch(
      createMapPool(type, draft.maps, draft.maxVetoCount, Date.parse(draft.startDate), {
        onSuccess: data => {
          setPools(existing =>
            sortPools(concatWithoutDuplicates(existing ?? [], [data.pool], p => p.id)),
          )
          setDraft(d => (d?.id === id ? undefined : d))
          snackbarController.showSnackbar('Map pool scheduled')
        },
        onError: err => {
          setDraft(d =>
            d?.id === id ? { ...d, submitting: false, error: requestErrorText(err) } : d,
          )
        },
      }),
    )
  }

  const removePool = (pool: MatchmakingMapPoolJson) => {
    dispatch(
      deleteMapPool(pool.id, {
        onSuccess: () => {
          setPools(existing => existing?.filter(p => p.id !== pool.id))
          snackbarController.showSnackbar('Map pool deleted')
        },
        onError: () => {
          snackbarController.showSnackbar('Error deleting map pool')
        },
      }),
    )
  }

  if (draft && picking) {
    return (
      <Root>
        <DraftMapsPicker
          draft={draft}
          title={`the ${typeLabel} pool`}
          onAdd={addToDraft}
          onClose={() => setPicking(false)}
        />
      </Root>
    )
  }

  let poolsContent: React.ReactNode
  if (!pools) {
    poolsContent = loadError ? (
      <LoadErrorRow message="Couldn't load map pools" onRetry={loadMorePools} />
    ) : (
      <LoadingDotsArea />
    )
  } else if (!pools.length) {
    poolsContent = (
      <EmptyState>
        <EmptyText>No map pools yet.</EmptyText>
        <FilledButton label='New pool' iconStart='add' onClick={() => startDraft()} />
      </EmptyState>
    )
  } else {
    const { scheduled, current, history } = groupPools(pools, now)
    poolsContent = (
      <>
        {scheduled.length ? (
          <>
            <SectionTitle>Scheduled</SectionTitle>
            {scheduled.map(pool => (
              <PoolBlock
                key={pool.id}
                pool={pool}
                kind='scheduled'
                onTemplate={() => startDraft(pool)}
                onDelete={() => removePool(pool)}
              />
            ))}
          </>
        ) : null}
        {current ? (
          <>
            <SectionTitle>Current</SectionTitle>
            <PoolBlock pool={current} kind='current' onTemplate={() => startDraft(current)} />
          </>
        ) : null}
        {history.length ? (
          <>
            <SectionTitle>History</SectionTitle>
            {history.map(({ pool, endDate }) => (
              <PoolBlock
                key={pool.id}
                pool={pool}
                kind='past'
                endDate={endDate}
                expanded={expanded.has(pool.id)}
                onToggle={() =>
                  setExpanded(prev => {
                    const next = new Set(prev)
                    if (!next.delete(pool.id)) {
                      next.add(pool.id)
                    }
                    return next
                  })
                }
                onTemplate={() => startDraft(pool)}
              />
            ))}
          </>
        ) : null}
        {loadError ? (
          <LoadErrorRow message="Couldn't load more map pools" onRetry={loadMorePools} />
        ) : null}
        {hasMorePools && !loadError ? (
          <TextButton
            label={isLoadingPools ? 'Loading' : 'Load more'}
            disabled={isLoadingPools}
            onClick={loadMorePools}
          />
        ) : null}
      </>
    )
  }

  return (
    <Root>
      <AdminRail>
        <MatchmakingTypeNav label='Mode' activeType={type} onChange={onTypeChange} />
      </AdminRail>

      <Container>
        <PageHeadline>Matchmaking map pools</PageHeadline>

        <Content>
          {draft ? (
            <DraftCard
              key={draft.id}
              draft={draft}
              title={`New ${typeLabel} pool`}
              onChange={changeDraft}
              onSwapFile={swapFile}
              onAddMaps={() => setPicking(true)}
              onSchedule={schedule}
              onClose={() => setDraft(undefined)}
            />
          ) : null}
          {poolsContent}
        </Content>
      </Container>
    </Root>
  )
}

const PoolRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PoolHeader = styled.div`
  min-height: 40px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
`

const PoolDates = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const PoolMeta = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const PoolActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const RowList = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
  gap: 6px;
`

/**
 * A pool on one header line (its dates, size, vetoes and actions) with its maps under it. A past
 * pool's maps show (and load) only while it's expanded.
 */
function PoolBlock({
  pool,
  kind,
  endDate,
  expanded = true,
  onToggle,
  onTemplate,
  onDelete,
}: {
  pool: MatchmakingMapPoolJson
  kind: 'scheduled' | 'current' | 'past'
  /** When a past pool stopped being played. */
  endDate?: number
  expanded?: boolean
  onToggle?: () => void
  onTemplate: () => void
  onDelete?: () => void
}) {
  const poolDate = useFormat(dayFormat)
  const timestamp = useFormat(longTimestamp)
  const collectionId = usePoolCollectionId(pool, kind !== 'scheduled')

  let dates: string
  if (kind === 'scheduled') {
    dates = `Starts ${timestamp.format(pool.startDate)}`
  } else if (kind === 'current' || endDate === undefined) {
    dates = `Since ${poolDate.format(pool.startDate)}`
  } else {
    dates = `${poolDate.format(pool.startDate)} – ${poolDate.format(endDate)}`
  }
  const meta = `${pool.maps.length} ${pool.maps.length === 1 ? 'map' : 'maps'} · Max vetoes ${
    pool.maxVetoCount
  }`

  return (
    <PoolRoot>
      <PoolHeader>
        {onToggle ? (
          <TextButton
            label={dates}
            iconStart={expanded ? 'expand_less' : 'expand_more'}
            onClick={onToggle}
          />
        ) : (
          <PoolDates>{dates}</PoolDates>
        )}
        <PoolMeta>{meta}</PoolMeta>
        <FlexSpacer />
        <PoolActions>
          {collectionId ? (
            <Tooltip text='Public page' position='bottom' tabIndex={-1}>
              <IconButton
                icon={<MaterialIcon icon='open_in_new' />}
                ariaLabel='Public page'
                onClick={() => push(urlForMapCollection(makeMapCollectionId(collectionId)))}
              />
            </Tooltip>
          ) : null}
          {onDelete ? <TextButton label='Delete' onClick={onDelete} /> : null}
          {kind === 'current' ? (
            <FilledButton
              label='New pool from this'
              iconStart='content_copy'
              onClick={onTemplate}
            />
          ) : (
            <TextButton label='Use as template' iconStart='content_copy' onClick={onTemplate} />
          )}
        </PoolActions>
      </PoolHeader>
      {expanded ? (
        <RowList>
          {pool.maps.map(mapId => (
            <PoolMapRow key={mapId} mapId={mapId} />
          ))}
        </RowList>
      ) : null}
    </PoolRoot>
  )
}

/**
 * The id of the collection that is `pool`'s public page, found among the ladder pools holding its
 * first map. Undefined while that loads, and for a pool that hasn't started (only started pools have
 * a public page).
 */
function usePoolCollectionId(pool: MatchmakingMapPoolJson, started: boolean): string | undefined {
  const firstMapId = pool.maps.at(0)
  const [{ data }] = useQuery({
    query: AdminMapPoolCollectionQuery,
    variables: { id: firstMapId ?? makeSbMapId('') },
    pause: !started || !firstMapId,
    context: NO_SUSPENSE_CONTEXT,
  })
  return data?.map?.family.ladderPools.find(c => c.pool?.id === pool.id)?.id
}

/** Loads what a row shows about the file `mapId`. `failed` when there's no such file to show. */
function usePoolMapRow(mapId: SbMapId) {
  const [{ data, error }] = useQuery({
    query: AdminMapPoolRowQuery,
    variables: { id: mapId },
    context: NO_SUSPENSE_CONTEXT,
  })
  const map = data?.map ?? undefined
  return { map, failed: !map && (!!error || !!data) }
}

type PoolRowMap = NonNullable<ReturnType<typeof usePoolMapRow>['map']>

const PlaceholderThumbnail = styled(MapRowThumbnail)`
  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
`

/** The part of a row that links to the file's page: its image, name and facts. */
function RowFileLink({ map }: { map: PoolRowMap }) {
  const { t } = useTranslation()
  const tile = useFragment(MapTile_SbMapFragment, map)
  const name = filterColorCodes(tile.name)

  return (
    <MapRowLink href={urlForMapFile(tile.family, tile.id)}>
      <MapRowThumbnail>
        <MapFileImage file={tile.file} name={name} size={48} forceAspectRatio={1} />
      </MapRowThumbnail>
      <MapRowText>
        <MapRowNameLine>
          <MapRowName>{name}</MapRowName>
          {map.listed ? null : <MapRowChip>Unlisted</MapRowChip>}
        </MapRowNameLine>
        <MapRowMeta>{mapTileMeta(tile, t)}</MapRowMeta>
      </MapRowText>
    </MapRowLink>
  )
}

/** The image and text of a row whose file is loading, or couldn't be loaded. */
function RowPlaceholder({ mapId, failed }: { mapId: SbMapId; failed: boolean }) {
  return (
    <>
      <PlaceholderThumbnail>
        {failed ? <MaterialIcon icon='broken_image' size={24} /> : null}
      </PlaceholderThumbnail>
      <MapRowText>
        {failed ? (
          <>
            <MapRowName>Couldn't load this file</MapRowName>
            <MapRowMeta>{mapId}</MapRowMeta>
          </>
        ) : null}
      </MapRowText>
    </>
  )
}

/** One file of a pool on one line, linking to that file's page. */
function PoolMapRow({ mapId }: { mapId: SbMapId }) {
  const { map, failed } = usePoolMapRow(mapId)
  const tile = useFragment(MapTile_SbMapFragment, map)

  return (
    <MapRow>
      {map && tile ? (
        <>
          <RowFileLink map={map} />
          <MapRowGamesCount gamesTotal={tile.stats?.gamesTotal} />
        </>
      ) : (
        <RowPlaceholder mapId={mapId} failed={failed} />
      )}
    </MapRow>
  )
}

const DraftRoot = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;

  border-radius: 8px;
`

const DraftHeader = styled.div`
  width: 100%;

  display: flex;
  align-items: center;
  gap: 8px;
`

const DraftTitleText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const DraftTitle = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface);
`

const DraftSummary = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const DraftRows = styled(RowList)`
  width: 100%;
`

const DraftFields = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px 16px;

  & > * {
    width: 240px;
    flex-shrink: 0;
  }
`

/**
 * The pool being put together: its maps (each with a choice of its map's files), a way to add more,
 * its vetoes and start date, and how it differs from the pool it was based on.
 */
function DraftCard({
  draft,
  title,
  onChange,
  onSwapFile,
  onAddMaps,
  onSchedule,
  onClose,
}: {
  draft: PoolDraft
  title: string
  onChange: (changes: Partial<PoolDraft>) => void
  onSwapFile: (from: SbMapId, to: SbMapId, familyId: string) => void
  onAddMaps: () => void
  onSchedule: () => void
  onClose: () => void
}) {
  const summary = draft.base
    ? poolChangeSummary(draft.base, draft, id => draft.families.get(id))
    : undefined

  return (
    <DraftRoot>
      <DraftHeader>
        <DraftTitleText>
          <DraftTitle>{title}</DraftTitle>
          {summary ? <DraftSummary>{summary}</DraftSummary> : null}
        </DraftTitleText>
        <FlexSpacer />
        <Tooltip text='Discard' position='left' tabIndex={-1}>
          <IconButton icon={<MaterialIcon icon='close' />} ariaLabel='Discard' onClick={onClose} />
        </Tooltip>
      </DraftHeader>

      {draft.maps.length ? (
        <DraftRows>
          {draft.maps.map(mapId => (
            <DraftMapRow
              key={mapId}
              mapId={mapId}
              draftMaps={draft.maps}
              onSwapFile={(to, familyId) => onSwapFile(mapId, to, familyId)}
              onRemove={() => onChange({ maps: draft.maps.filter(id => id !== mapId) })}
            />
          ))}
        </DraftRows>
      ) : null}

      <OutlinedButton label='Add maps' iconStart='add' onClick={onAddMaps} />
      {draft.problems?.maps ? <ErrorText>{draft.problems.maps}</ErrorText> : null}

      <DraftFields>
        <NumberTextField
          value={draft.maxVetoCount}
          label='Max vetoes'
          floatingLabel={true}
          errorText={draft.problems?.maxVetoCount}
          inputProps={{ min: 0, tabIndex: 0 }}
          onChange={value => onChange({ maxVetoCount: value })}
        />
        <DateTimeTextField
          value={draft.startDate}
          label='Start date'
          floatingLabel={true}
          errorText={draft.problems?.startDate}
          inputProps={{ tabIndex: 0 }}
          onChange={event => onChange({ startDate: event.target.value })}
        />
      </DraftFields>

      {draft.error ? <ErrorText>{draft.error}</ErrorText> : null}
      <FilledButton label='Schedule pool' disabled={draft.submitting} onClick={onSchedule} />
    </DraftRoot>
  )
}

/** Keeps what it wraps above the link that covers the row, so it can be used. */
const RowAside = styled.div`
  position: relative;
  z-index: 1;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 4px;
`

/**
 * Wide enough to show a whole option label, e.g. `Sep 30, 2026 · Recommended`, clear of the
 * dropdown arrow, so the row's map name is what gets cut off when space runs out.
 */
const FileSelect = styled(Select)`
  width: 296px;
`

/**
 * One file of a draft pool on one line: what it is, a choice of its map's listed files (when there's
 * more than one), a way to switch to its map's recommended file when it isn't that one (and no other
 * row holds it), and a way to remove it.
 */
function DraftMapRow({
  mapId,
  draftMaps,
  onSwapFile,
  onRemove,
}: {
  mapId: SbMapId
  /** Every file in the draft, this row's included. */
  draftMaps: ReadonlyArray<SbMapId>
  onSwapFile: (to: SbMapId, familyId: string) => void
  onRemove: () => void
}) {
  const fileDate = useFormat(dayFormat)
  const numbers = useFormat(compactNumber)
  const { map, failed } = usePoolMapRow(mapId)
  const tile = useFragment(MapTile_SbMapFragment, map)

  let aside: React.ReactNode
  if (map && tile) {
    const family = map.family
    const recommendedId = family.current.id
    const files = orderFamilyFiles(
      family.files
        .filter(f => f.listed || f.id === map.id)
        .map(f => ({ ...f, gamesTotal: f.stats?.gamesTotal ?? 0 })),
      recommendedId,
    )
    aside = (
      <>
        {map.id !== recommendedId &&
        family.files.length > 1 &&
        !draftMaps.includes(recommendedId) ? (
          <RowAside>
            <Tooltip text="This isn't the map's recommended file" position='top' tabIndex={-1}>
              <TextButton
                label='Use recommended'
                onClick={() => onSwapFile(recommendedId, family.id)}
              />
            </Tooltip>
          </RowAside>
        ) : null}
        {files.length > 1 ? (
          <RowAside>
            <FileSelect
              value={map.id}
              dense={true}
              allowErrors={false}
              ariaLabel='File'
              onChange={(fileId: SbMapId) => {
                if (fileId !== map.id) {
                  onSwapFile(fileId, family.id)
                }
              }}>
              {files.map(file => {
                const games = file.gamesTotal
                return (
                  <SelectOption
                    key={file.id}
                    value={file.id}
                    text={`${fileDate.format(new Date(file.firstSeenAt))}${
                      file.id === recommendedId ? ' · Recommended' : ''
                    }`}
                    secondaryText={`${filterColorCodes(file.name)} · ${numbers.format(games)} ${
                      games === 1 ? 'game' : 'games'
                    }${file.listed ? '' : ' · Unlisted'}`}
                    dense={true}
                  />
                )
              })}
            </FileSelect>
          </RowAside>
        ) : null}
        <MapRowGamesCount gamesTotal={tile.stats?.gamesTotal} />
      </>
    )
  }

  return (
    <MapRow>
      {map ? <RowFileLink map={map} /> : <RowPlaceholder mapId={mapId} failed={failed} />}
      {aside}
      <MapRowControls $slots={1}>
        <Tooltip text='Remove' position='top' tabIndex={-1}>
          <MapRowControlButton
            icon={<MaterialIcon icon='close' size={20} />}
            ariaLabel='Remove'
            onClick={onRemove}
          />
        </Tooltip>
      </MapRowControls>
    </MapRow>
  )
}

/**
 * The map picker, adding each picked map's file to the draft and marking the maps the draft holds.
 * It stays open until closed.
 */
function DraftMapsPicker({
  draft,
  title,
  onAdd,
  onClose,
}: {
  draft: PoolDraft
  /** What the picker adds maps to, e.g. `the 1v1 pool`. */
  title: string
  onAdd: (mapId: SbMapId, familyId: string) => void
  onClose: () => void
}) {
  const client = useClient()
  const snackbarController = useSnackbarController()
  const pickerSession = useMapPickerSession()
  const heldFamilyIds = new Set(
    draft.maps.flatMap(id => {
      const familyId = draft.families.get(id)
      return familyId ? [familyId] : []
    }),
  )

  const add = async (mapId: SbMapId, familyId?: string): Promise<boolean> => {
    let family = familyId
    if (!family) {
      const result = await client.query(AdminMapPoolRowQuery, { id: mapId }).toPromise()
      family = result.data?.map?.family.id
      if (!family) {
        snackbarController.showSnackbar("Couldn't load that map")
        return false
      }
    }
    if (draft.maps.includes(mapId) || heldFamilyIds.has(family)) {
      snackbarController.showSnackbar('That map is already in the pool')
      return false
    }
    onAdd(mapId, family)
    return true
  }

  const uploadFiles = useUploadMapFiles({
    onStart: () => pickerSession.showUploads(),
    onUploaded: (map, files) => {
      // With several files there's no telling which one was meant, so they're only shown
      if (files.length === 1) {
        add(map.id).catch(swallowNonBuiltins)
      }
    },
  })

  const target: MapPickerCollectionTarget = {
    // The draft isn't a collection yet, so no collection is left out of the Collections tab
    id: '',
    title,
    mapCount: draft.maps.length,
    full: false,
    heldLabel: 'In this pool',
    countLabel: `${draft.maps.length} ${draft.maps.length === 1 ? 'map' : 'maps'} in this pool`,
    holds: familyId => heldFamilyIds.has(familyId),
    add,
  }

  return (
    <PickerRoot>
      <MapPicker
        mode={MapPickerMode.Collection}
        collection={target}
        onUploadFiles={uploadFiles}
        onClose={onClose}
      />
    </PickerRoot>
  )
}
