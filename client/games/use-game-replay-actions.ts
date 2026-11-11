import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { getErrorStack } from '../../common/errors'
import { GameReplayInfo } from '../../common/games/games'
import { openSimpleDialog } from '../dialogs/action-creators'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { watchGameReplay } from './action-creators'
import { startingReplayGameIdsAtom } from './game-atoms'

export interface UseGameReplayActionsResult {
  /** Info about this game's replay, if one is available and the user has access to it. */
  replayInfo: GameReplayInfo | undefined
  /**
   * Downloads (if needed) and starts watching this game's replay. No-op if there isn't one, or
   * while `isStartingReplay`.
   */
  onWatchReplay: () => void
  /**
   * Whether this game's replay is on its way to being watched, from any surface. Watch actions
   * should be disabled while it is.
   */
  isStartingReplay: boolean
}

function setStartingReplay(gameId: string, starting: boolean) {
  const gameIds = new Set(jotaiStore.get(startingReplayGameIdsAtom))
  if (starting) {
    gameIds.add(gameId)
  } else {
    gameIds.delete(gameId)
  }
  jotaiStore.set(startingReplayGameIdsAtom, gameIds)
}

/**
 * The watch action for a game's replay, shared by any surface that offers it (list rows, side
 * panels, the results page). Saving is handled separately, by the "Save replay" destination menu
 * (`client/games/save-replay-menu.tsx`), since it needs a picked destination rather than a single
 * action. Callers handle their own mouse-event concerns (e.g. `stopPropagation` to keep a click on
 * these actions from also selecting the underlying row).
 */
export function useGameReplayActions(gameId: string): UseGameReplayActionsResult {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const replayInfo = useAppSelector(s => s.games.replayInfoById.get(gameId))
  const isStartingReplay = useAtomValue(startingReplayGameIdsAtom).has(gameId)

  const onWatchReplay = () => {
    // Read at press time rather than from the render, so two presses that land before a rerender
    // can't both get through.
    if (!replayInfo || jotaiStore.get(startingReplayGameIdsAtom).has(gameId)) return

    // The flag is cleared through the global store, since the surface may be gone by the time the
    // replay starts.
    setStartingReplay(gameId, true)
    dispatch(
      watchGameReplay(replayInfo, gameId, {
        onSuccess: () => {
          setStartingReplay(gameId, false)
        },
        onError: err => {
          setStartingReplay(gameId, false)
          logger.error(`Error watching replay: ${getErrorStack(err)}`)
          dispatch(
            openSimpleDialog(
              t('replays.watch.errorTitle', 'Error loading replay'),
              err?.message ??
                t(
                  'replays.watch.errorBody',
                  'There was a problem downloading or loading the replay. Please try again later.',
                ),
            ),
          )
        },
      }),
    )
  }

  return { replayInfo, onWatchReplay, isStartingReplay }
}
