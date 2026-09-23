import { useAtomValue } from 'jotai'
import { useEffect, useEffectEvent } from 'react'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import { MatchmakingType } from '../../common/matchmaking'
import { getInstantaneousSelfRank } from '../ladder/action-creators'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CustomGameSetup } from './custom-game-setup'
import { effectivePoolMapIds, useSyncLadderMapPool } from './ladder-pool'
import { OpponentPicker } from './opponent-picker'
import { practiceStoreAtom } from './practice-atoms'
import { PracticeHome } from './practice-home'
import { refreshInstalledMaps } from './practice-launch'
import { PracticeSetup } from './practice-setup'
import { knownMapIdsToMaps } from './practice-store'

/**
 * The column every practice page lives in. The surrounding play page already centers content and
 * provides the top padding, so this only adds the vertical rhythm between a page's sections.
 */
export const PracticePageColumn = styled.div`
  width: 100%;
  padding: 24px 0;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

/**
 * Keeps the data every practice page reads from up to date: the official pool cache, whether the
 * maps the setup references are on disk, and the player's ladder rating for recommendations. None
 * of it is required to render, so an offline session just uses whatever was cached.
 */
function usePracticeData() {
  const dispatch = useAppDispatch()
  const store = useAtomValue(practiceStoreAtom)
  const isConnected = useAppSelector(s => s.network.isConnected)
  const hasSelfUser = useAppSelector(s => !!s.auth.self)
  const hasRank = useAppSelector(s => s.selfRank.byType.has(MatchmakingType.Match1v1))

  useSyncLadderMapPool()

  const relevantMapIds = [
    ...effectivePoolMapIds(store),
    ...store.matchmaking.customMapIds,
    ...(store.customGame.mapId ? [store.customGame.mapId] : []),
  ]
  const maps = knownMapIdsToMaps(store, relevantMapIds)
  // Rechecking the map store only pays off when the set of maps changes, not on every store edit.
  const mapIdKey = relevantMapIds.join(',')

  const checkMapsOnDisk = useEffectEvent(() => {
    refreshInstalledMaps(maps).catch(err => {
      logger.error(`Failed to check which practice maps are downloaded: ${err?.stack ?? err}`)
    })
  })

  useEffect(() => {
    checkMapsOnDisk()
  }, [mapIdKey])

  useEffect(() => {
    if (!isConnected || !hasSelfUser || hasRank) {
      return undefined
    }

    const abortController = new AbortController()
    dispatch(
      getInstantaneousSelfRank({
        signal: abortController.signal,
        onSuccess: () => {},
        onError: () => {},
      }),
    )
    return () => {
      abortController.abort()
    }
  }, [dispatch, isConnected, hasSelfUser, hasRank])
}

export function PracticeRoot() {
  usePracticeData()

  return (
    <Switch>
      <Route path='/play/practice/setup' component={PracticeSetup} />
      <Route path='/play/practice/opponents'>
        <OpponentPicker mode='lineup' />
      </Route>
      <Route path='/play/practice/bots'>
        <OpponentPicker mode='library' />
      </Route>
      <Route path='/play/practice/game/bots'>
        <OpponentPicker mode='slot' />
      </Route>
      <Route path='/play/practice/game'>
        <CustomGameSetup
          onBack={() => {
            push('/play/practice')
          }}
        />
      </Route>
      <Route component={PracticeHome} />
    </Switch>
  )
}
