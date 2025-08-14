import { NydusClient, RouteInfo } from 'nydus-client'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameLaunchConfig } from '../../common/games/game-launch-config'
import { GameLoaderEvent } from '../../common/games/game-loader-network'
import { stringToStatus } from '../../common/games/game-status'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl } from '../../common/urls'
import { dispatch, Dispatchable } from '../dispatch-registry'
import { lastGameAtom } from '../games/game-atoms'
import { jotaiStore } from '../jotai-store'
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
    cancelLoading(_, { gameId }) {
      ipcRenderer.invoke('activeGameClearConfig', gameId)?.catch(swallowNonBuiltins)
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

      if (status.state === 'playing') {
        jotaiStore.set(lastGameAtom, { id: status.id })
      }

      if (status.state === 'playing' || status.state === 'error') {
        let done = false
        let retries = 0

        // NOTE(tec27): Because these states are terminal, we don't need to worry about further
        // game states coming in that would need to abort these ones. If that ever changes, we'd
        // probably need a Map of game id -> abort controller or something
        const doFetch = () => {
          fetchJson(apiUrl`games/${status.id}/status`, {
            method: 'put',
            body: JSON.stringify({ status: stringToStatus(status.state), extra: status.extra }),
            signal: AbortSignal.timeout(2000),
          })
            .then(
              () => {
                logger.debug(`Reported game status for ${status.id} (${status.state}) to server`)
                done = true
              },
              err => {
                if (isFetchError(err)) {
                  if (err.status === 409 || err.status === 404) {
                    logger.error(
                      'Quitting current game due to error reporting game status to server: ' +
                        err.message,
                    )
                    ipcRenderer
                      .invoke('activeGameClearConfig', status.id)
                      ?.catch(swallowNonBuiltins)
                  }
                }
              },
            )
            .finally(() => {
              retries += 1
              if (!done && retries < 5) {
                logger.debug(`Retrying game status report for ${status.id} (${status.state})`)
                setTimeout(() => doFetch(), 500)
              } else if (!done) {
                logger.error(
                  `Failed to report game status for ${status.id} (${status.state}) after 5 attempts`,
                )
              }
            })
        }

        doFetch()
      }
    })
    .on('activeGameReplaySaved', (_, gameId, path) => {
      const currentLastGameState = jotaiStore.get(lastGameAtom)
      if (currentLastGameState?.id === gameId) {
        jotaiStore.set(lastGameAtom, { id: gameId, replayPath: path })
      }

      dispatch({
        type: '@active-game/replaySaved',
        payload: { gameId, path },
      })
    })
}
