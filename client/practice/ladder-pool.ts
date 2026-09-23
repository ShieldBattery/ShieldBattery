import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { PracticeStoreData } from '../../common/bots/practice'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { jotaiStore } from '../jotai-store'
import { getCurrentMapPool } from '../matchmaking/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { practiceStoreAtom } from './practice-atoms'
import { rememberMaps, updatePracticeStore } from './practice-store'

/** The official 1v1 pool practice can draw from, either freshly fetched or the last downloaded one. */
export interface LadderPoolInfo {
  mapIds: SbMapId[]
  poolId: number
  /** When this pool became the current one. */
  startDate: number
  /** True when these ids come from the local cache rather than a fresh fetch. */
  fromCache: boolean
}

/**
 * Fetches the current 1v1 ladder pool and keeps the local copy of it up to date. The cache is what
 * makes ladder-pool practice work offline, so every successful fetch also stores the pool's map
 * metadata. Call this once per mounted practice section; the pages themselves only read.
 */
export function useSyncLadderMapPool(): void {
  const dispatch = useAppDispatch()
  const isConnected = useAppSelector(s => s.network.isConnected)
  const serverPool = useAppSelector(s => s.mapPools.byType.get(MatchmakingType.Match1v1))
  const mapsById = useAppSelector(s => s.maps.byId)

  useEffect(() => {
    if (isConnected) {
      dispatch(getCurrentMapPool(MatchmakingType.Match1v1))
    }
  }, [dispatch, isConnected])

  useEffect(() => {
    if (!serverPool) {
      return
    }

    const mapIds = Array.from(serverPool.maps) as SbMapId[]
    const maps = mapIds
      .map(id => mapsById.get(id))
      .filter((m): m is MapInfoJson => !!m)
      .map(m => m as MapInfoJson)
    rememberMaps(maps)

    const stored = jotaiStore.get(practiceStoreAtom).cachedLadderPool
    if (
      stored?.poolId === serverPool.id &&
      stored.startDate === serverPool.startDate &&
      stored.mapIds.length === mapIds.length &&
      stored.mapIds.every((id, i) => id === mapIds[i])
    ) {
      return
    }

    updatePracticeStore(draft => {
      draft.cachedLadderPool = {
        matchmakingType: MatchmakingType.Match1v1,
        poolId: serverPool.id,
        fetchedAt: Date.now(),
        startDate: serverPool.startDate,
        mapIds,
      }
    })
  }, [serverPool, mapsById])
}

/** Whichever copy of the official 1v1 pool is usable right now, fresh or cached. */
export function useLadderMapPool(): { pool: LadderPoolInfo | undefined } {
  const serverPool = useAppSelector(s => s.mapPools.byType.get(MatchmakingType.Match1v1))
  const cached = useAtomValue(practiceStoreAtom).cachedLadderPool

  if (serverPool) {
    return {
      pool: {
        mapIds: Array.from(serverPool.maps) as SbMapId[],
        poolId: serverPool.id,
        startDate: serverPool.startDate,
        fromCache: false,
      },
    }
  }
  if (cached) {
    return {
      pool: {
        mapIds: cached.mapIds,
        poolId: cached.poolId,
        startDate: cached.startDate,
        fromCache: true,
      },
    }
  }
  return { pool: undefined }
}

/** Every map of the current pool source, vetoed ones included, for display. */
export function fullPoolMapIds(store: PracticeStoreData): SbMapId[] {
  const source = store.matchmaking.mapPool
  switch (source.kind) {
    case 'ladder':
      return [...(store.cachedLadderPool?.mapIds ?? [])]
    case 'preset':
      return [...(store.mapPoolPresets.find(p => p.id === source.presetId)?.mapIds ?? [])]
    case 'custom':
      return [...store.matchmaking.customMapIds]
    default:
      return source satisfies never
  }
}

function applyVetoes(store: PracticeStoreData, pool: ReadonlyArray<SbMapId>): SbMapId[] {
  const vetoed = new Set(store.matchmaking.vetoMapIds ?? [])
  const kept = pool.filter(id => !vetoed.has(id))
  return kept.length > 0 ? kept : [...pool]
}

/** The map ids the practice matchmaking setup would draw from, whichever pool source it uses. */
export function effectivePoolMapIds(store: PracticeStoreData): SbMapId[] {
  const source = store.matchmaking.mapPool
  switch (source.kind) {
    case 'ladder':
      return applyVetoes(store, store.cachedLadderPool?.mapIds ?? [])
    case 'preset':
      return applyVetoes(
        store,
        store.mapPoolPresets.find(p => p.id === source.presetId)?.mapIds ?? [],
      )
    case 'custom':
      return [...store.matchmaking.customMapIds]
    default:
      return source satisfies never
  }
}
