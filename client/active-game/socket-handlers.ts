import swallowNonBuiltins from '../../common/async/swallow-non-builtins.js'
import { stringToStatus } from '../../common/game-status.js'
import { TypedIpcRenderer } from '../../common/ipc.js'
import { apiUrl } from '../../common/urls.js'
import { dispatch } from '../dispatch-registry.js'
import logger from '../logging/logger.js'
import { isFetchError } from '../network/fetch-errors.js'
import { fetchJson } from '../network/fetch.js'
import { updateActiveGame } from './wait-for-active-game.js'

export default function ({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
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
