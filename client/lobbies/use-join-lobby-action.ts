import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { isMatchmakingAtom } from '../matchmaking/matchmaking-atoms'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { healthChecked } from '../starcraft/health-checked'
import { joinLobby } from './action-creators'
import { lobbyJoinErrorMessage } from './lobby-join-errors'
import { navigateToLobby } from './lobby-url'

/**
 * Returns a function that joins a lobby the way clicking one in the lobby list does. On web it
 * shows the download dialog; in the app it refuses while a matchmaking search is active, and
 * otherwise health-checks the game install, dispatches the join (reporting failures in a
 * snackbar, and to `onError` if given), and navigates to the lobby route, which shows the join's
 * outcome.
 */
export function useJoinLobbyAction(): (
  lobbyId: SbLobbyId,
  options?: { name?: string; onError?: (err: unknown) => void },
) => void {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const isMatchmaking = useAtomValue(isMatchmakingAtom)

  return (lobbyId, options) => {
    if (!IS_ELECTRON) {
      dispatch(openDialog({ type: DialogType.Download }))
      return
    }
    if (isMatchmaking) {
      dispatch(
        openSimpleDialog(
          t('lobbies.joinLobby.matchmakingActiveDialogTitle', 'Joining lobbies disabled'),
          t(
            'lobbies.joinLobby.matchmakingActiveDialogText',
            'You cannot join lobbies while a matchmaking search is active.',
          ),
        ),
      )
      return
    }

    healthChecked(() => {
      dispatch(
        joinLobby(lobbyId, {
          onError: (err: unknown) => {
            snackbarController.showSnackbar(lobbyJoinErrorMessage(err, t))
            options?.onError?.(err)
          },
        }),
      )
      navigateToLobby(lobbyId, options?.name)
    })()
  }
}
