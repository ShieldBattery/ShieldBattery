import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameRecordJson, GameReplayInfo } from '../../common/games/games'
import { openSimpleDialog } from '../dialogs/action-creators'
import logger from '../logging/logger'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { saveReplayToLibrary, watchReplayFromUrl } from '../replays/action-creators'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

export interface UseGameReplayActionsResult {
  /** Info about this game's replay, if one is available and the user has access to it. */
  replayInfo: GameReplayInfo | undefined
  /** Downloads (if needed) and starts watching this game's replay. No-op if there isn't one. */
  onWatchReplay: () => void
  /** Downloads (if needed) and saves this game's replay into the local replay library. No-op if
   * there isn't one. */
  onSaveReplay: () => void
}

/**
 * Watch/save actions for a game's replay, shared by any surface that offers those controls (list
 * rows, side panels). Callers handle their own mouse-event concerns (e.g. `stopPropagation` to
 * keep a click on these actions from also selecting the underlying row).
 */
export function useGameReplayActions(
  game: ReadonlyDeep<GameRecordJson>,
): UseGameReplayActionsResult {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
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

  const onSaveReplay = () => {
    if (!replayInfo) return

    dispatch(
      saveReplayToLibrary(replayInfo, {
        onSuccess: result => {
          snackbarController.showSnackbar(
            result.alreadySaved
              ? t(
                  'gameDetails.saveReplayAlreadySaved',
                  "This game's replay is already in your library",
                )
              : t('gameDetails.saveReplaySuccess', 'Replay saved to your library'),
          )
        },
        onError: err => {
          logger.error(`Error saving replay: ${getErrorStack(err)}`)
          snackbarController.showSnackbar(
            t('gameDetails.saveReplayError', 'There was a problem saving the replay'),
          )
        },
      }),
    )
  }

  return { replayInfo, onWatchReplay, onSaveReplay }
}
