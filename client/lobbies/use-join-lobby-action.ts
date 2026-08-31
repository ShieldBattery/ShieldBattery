import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { isMatchmakingAtom } from '../matchmaking/matchmaking-atoms'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { healthChecked } from '../starcraft/health-checked'
import { joinLobby } from './action-creators'
import { lobbyJoinErrorMessage } from './lobby-join-errors'
import { isInLobby } from './lobby-reducer'
import { isAtLobbyRoute, navigateToLobby } from './lobby-url'

export interface JoinLobbyActionOptions {
  /** The lobby's name, used to build the URL the join navigates to. */
  name?: string
  /** Ask for an observer seat specifically, failing rather than taking a player seat or the bench. */
  asObserver?: boolean
  /**
   * Called with a user-facing message and the underlying error when the join fails. Providing it
   * also holds the navigation back until the join succeeds, so a surface that can show the
   * failure in place (with the lobby still on screen) gets to, instead of the lobby view
   * reporting it after a navigation. The raw error lets a caller branch on
   * `lobbyJoinErrorCode(error)` for outcomes it wants to render as their own state rather than a
   * generic message (e.g. the lobby having closed or already started).
   */
  onJoinFailed?: (message: string, error: unknown) => void
}

/**
 * Returns a `[join, isPending]` pair. `join` joins a lobby the way clicking one in the lobby
 * browser does: on web it shows the download dialog; in the app it refuses while a matchmaking
 * search is active.
 *
 * A client can only ever be seated in one lobby: already being in the target lobby just navigates
 * there, and being in a different one opens a confirmation before trading it for the new one.
 * Otherwise it health-checks the game install and dispatches the join.
 *
 * Without `onJoinFailed` it navigates to the lobby route straight away and reports a failure in a
 * snackbar, since the route is where the join's outcome would be seen anyway.
 *
 * `isPending` is true only for the span where an actual join request is in flight (from the
 * moment it's dispatched to its success/error) -- not while a side dialog (download, matchmaking-
 * blocked, leave-and-join confirmation) is open instead, since those never fire the request this
 * call would have. Callers that want to keep a user from firing a second overlapping join request
 * (a double-click, an impatient retry) should disable their join affordances while it's true.
 */
export function useJoinLobbyAction(): [
  join: (lobbyId: SbLobbyId, options?: JoinLobbyActionOptions) => void,
  isPending: boolean,
] {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const isMatchmaking = useAtomValue(isMatchmakingAtom)
  const inCurrentLobby = useAppSelector(s => isInLobby(s.lobby))
  const currentLobbyId = useAppSelector(s => s.lobby.info.id)
  const [isPending, setIsPending] = useState(false)

  const join = (lobbyId: SbLobbyId, options?: JoinLobbyActionOptions) => {
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

    if (inCurrentLobby) {
      if (currentLobbyId === lobbyId) {
        navigateToLobby(lobbyId, options?.name)
      } else {
        dispatch(
          openDialog({
            type: DialogType.LobbyLeaveAndJoin,
            initData: {
              lobbyId,
              name: options?.name,
              asObserver: options?.asObserver,
              onJoinFailed: options?.onJoinFailed,
            },
          }),
        )
      }
      return
    }

    const onJoinFailed = options?.onJoinFailed

    healthChecked(() => {
      setIsPending(true)
      dispatch(
        joinLobby(
          lobbyId,
          { asObserver: options?.asObserver },
          {
            onSuccess: () => {
              setIsPending(false)
              if (onJoinFailed && !isAtLobbyRoute(lobbyId)) {
                navigateToLobby(lobbyId, options?.name)
              }
            },
            onError: (err: unknown) => {
              setIsPending(false)
              const message = lobbyJoinErrorMessage(err, t)
              if (onJoinFailed) {
                onJoinFailed(message, err)
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

  return [join, isPending]
}
