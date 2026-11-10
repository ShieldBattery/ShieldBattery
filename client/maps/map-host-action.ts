import { useTranslation } from 'react-i18next'
import { SbMapId } from '../../common/maps'
import { urlPath } from '../../common/urls'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { updateLobbySettings } from '../lobbies/action-creators'
import { isInLobby } from '../lobbies/lobby-reducer'
import { navigateToLobby } from '../lobbies/lobby-url'
import { push } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

/**
 * Returns how a map file gets played from a map's page: hosting a lobby with it, or, while the
 * viewer is hosting a lobby in the app, switching that lobby to it. `isLobbyHost` says which.
 */
export function useMapHostAction(): {
  isLobbyHost: boolean
  play: (mapId: SbMapId) => void
} {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()

  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const lobbyId = useAppSelector(s => s.lobby.info.id)
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const lobbyHostId = useAppSelector(s => s.lobby.info.host.userId)
  const lobbyMapId = useAppSelector(s => s.lobby.info.map?.id)
  const isLobbyHost = IS_ELECTRON && inLobby && !!selfUser && lobbyHostId === selfUser.id

  const host = (mapId: SbMapId) => {
    if (!IS_ELECTRON) {
      dispatch(openDialog({ type: DialogType.Download }))
    } else if (!selfUser) {
      redirectToLogin(push)
    } else {
      push(urlPath`/play/lobbies/create?map=${mapId}`)
    }
  }

  const switchLobbyMap = (mapId: SbMapId) => {
    if (lobbyMapId === mapId) {
      navigateToLobby(lobbyId, lobbyName)
      return
    }
    dispatch(
      updateLobbySettings(
        { map: mapId },
        {
          onSuccess: () => navigateToLobby(lobbyId, lobbyName),
          onError: () =>
            snackbarController.showSnackbar(
              t(
                'maps.page.useInLobbyError',
                "Couldn't change your lobby's map. It may not fit the lobby's current setup.",
              ),
            ),
        },
      ),
    )
  }

  return { isLobbyHost, play: isLobbyHost ? switchLobbyMap : host }
}
