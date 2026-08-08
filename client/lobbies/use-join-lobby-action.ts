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

export interface JoinLobbyActionOptions {
  /** The lobby's name, used to build the URL the join navigates to. */
  name?: string
  /** Ask for an observer seat specifically, failing rather than taking a player seat or the bench. */
  asObserver?: boolean
  /**
   * Called with a user-facing message when the join fails. Providing it also holds the navigation
   * back until the join succeeds, so a surface that can show the failure in place (with the lobby
   * still on screen) gets to, instead of the lobby view reporting it after a navigation.
   */
  onJoinFailed?: (message: string) => void
}

/**
 * Returns a function that joins a lobby the way clicking one in the lobby browser does. On web it
 * shows the download dialog; in the app it refuses while a matchmaking search is active, and
 * otherwise health-checks the game install and dispatches the join.
 *
 * Without `onJoinFailed` it navigates to the lobby route straight away and reports a failure in a
 * snackbar, since the route is where the join's outcome would be seen anyway.
 */
export function useJoinLobbyAction(): (
  lobbyId: SbLobbyId,
  options?: JoinLobbyActionOptions,
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

    const onJoinFailed = options?.onJoinFailed

    healthChecked(() => {
      dispatch(
        joinLobby(
          lobbyId,
          { asObserver: options?.asObserver },
          {
            onSuccess: () => {
              if (onJoinFailed) {
                navigateToLobby(lobbyId, options?.name)
              }
            },
            onError: (err: unknown) => {
              const message = lobbyJoinErrorMessage(err, t)
              if (onJoinFailed) {
                onJoinFailed(message)
              } else {
                snackbarController.showSnackbar(message)
              }
            },
          },
        ),
      )

      if (!onJoinFailed) {
        navigateToLobby(lobbyId, options?.name)
      }
    })()
  }
}
