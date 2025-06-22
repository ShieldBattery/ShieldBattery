import { NydusClient, RouteInfo } from 'nydus-client'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameLaunchConfig } from '../../common/games/game-launch-config'
import { GameLoaderEvent } from '../../common/games/game-loader-network'
import { stringToStatus } from '../../common/games/game-status'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl } from '../../common/urls'
import { dispatch, Dispatchable } from '../dispatch-registry'
import logger from '../logging/logger'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { makeServerUrl } from '../network/server-url'
import { updateActiveGame } from './wait-for-active-game'

type EventToActionMap = {
  [E in GameLoaderEvent['type']]: (
    gameId: string,
    event: Extract<GameLoaderEvent, { type: E }>,
  ) => Dispatchable | void
}

export default function ({
  ipcRenderer,
  siteSocket,
}: {
  ipcRenderer: TypedIpcRenderer
  siteSocket: NydusClient
}) {
  const eventToAction: EventToActionMap = {
    setGameConfig(_, { setup, gameId }) {
      return (dispatch, getState) => {
        const {
          auth: { self },
        } = getState()

        if ('mapUrl' in setup.map) {
          const {
            hash,
            mapData: { format },
            mapUrl,
          } = setup.map
          // The map should already be downloaded at this point, but just in case we trigger a check
          // to re-download it if necessary
          ipcRenderer.invoke('mapStoreDownloadMap', hash, format, mapUrl!)?.catch(err => {
            // TODO(tec27): Report this to the server so the loading is canceled immediately

            // This is already logged to our file by the map store, so we just log it to the console
            // for easy visibility during development
            console.error('Error downloading map: ' + err.stack)
          })
        }

        const config: GameLaunchConfig = {
          localUser: {
            id: self!.user.id,
            name: self!.user.name,
          },
          serverConfig: {
            serverUrl: makeServerUrl(''),
          },
          setup,
        }
        ipcRenderer.invoke('activeGameSetConfig', config)?.catch(swallowNonBuiltins)
      }
    },
    setRoutes(_, { routes, gameId }) {
      ipcRenderer.invoke('activeGameSetRoutes', gameId, routes)?.catch(swallowNonBuiltins)
    },
    startWhenReady(_, { gameId }) {
      ipcRenderer.invoke('activeGameStartWhenReady', gameId)?.catch(swallowNonBuiltins)
    },
  }

  siteSocket.registerRoute(
    '/gameLoader/:gameId/:userId',
    (route: RouteInfo, event: GameLoaderEvent) => {
      const action = eventToAction[event.type]?.(route.params.gameId, event as any)
      if (action) {
        dispatch(action)
      }
    },
  )

  ipcRenderer
    .on('activeGameStatus', (event, status) => {
      dispatch({
        type: '@active-game/status',
        payload: status,
      })

      updateActiveGame(status)

      if (status.isReplay) {
        // Don't report replay status to the server (because it will error out and result in us
        // quitting the game immediately). We may want to change this at some point, but we'll have
        // to make the server assign replay IDs in that case.
        return
      }

      if (status.state === 'playing' || status.state === 'error') {
        fetchJson(apiUrl`games/${status.id}/status`, {
          method: 'put',
          body: JSON.stringify({ status: stringToStatus(status.state), extra: status.extra }),
        }).catch(err => {
          if (isFetchError(err)) {
            if (err.status === 409 || err.status === 404) {
              logger.error(
                'Quitting current game due to error reporting game status to server: ' +
                  err.message,
              )
              // TODO(tec27): This feels kinda dangerous because this request might not have been
              // for the current game even... We should probably rework this API a bit.
              ipcRenderer.invoke('activeGameSetConfig', {})?.catch(swallowNonBuiltins)
            }
          }
        })
      }
    })
    .on('activeGameReplaySaved', (_, gameId, path) => {
      dispatch({
        type: '@active-game/replaySaved',
        payload: { gameId, path },
      })
    })
}
