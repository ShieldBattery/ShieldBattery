import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameRecordJson, GameReplayInfo } from '../../common/games/games'
import { openSimpleDialog } from '../dialogs/action-creators'
import logger from '../logging/logger'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { watchReplayFromUrl } from '../replays/action-creators'

export interface UseGameReplayActionsResult {
  /** Info about this game's replay, if one is available and the user has access to it. */
  replayInfo: GameReplayInfo | undefined
  /** Downloads (if needed) and starts watching this game's replay. No-op if there isn't one. */
  onWatchReplay: () => void
}

/**
 * The watch action for a game's replay, shared by any surface that offers it (list rows, side
 * panels, the results page). Saving is handled separately, by the "Save replay" destination menu
 * (`client/games/save-replay-menu.tsx`), since it needs a picked destination rather than a single
 * action. Callers handle their own mouse-event concerns (e.g. `stopPropagation` to keep a click on
 * these actions from also selecting the underlying row).
 */
export function useGameReplayActions(
  game: ReadonlyDeep<GameRecordJson>,
): UseGameReplayActionsResult {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const replayInfo = useAppSelector(s => s.games.replayInfoById.get(game.id))

  const onWatchReplay = () => {
    if (!replayInfo) return

    dispatch(
      watchReplayFromUrl(replayInfo, game.id, {
        onSuccess: () => {},
        onError: err => {
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

  return { replayInfo, onWatchReplay }
}
