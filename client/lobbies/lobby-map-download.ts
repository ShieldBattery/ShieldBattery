import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { Lobby } from '../../common/lobbies'
import { LobbyMapStatus, SetLobbyMapStatusRequest } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SbMapId } from '../../common/maps'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isInLobby } from './lobby-reducer'

const ipcRenderer = new TypedIpcRenderer()

/**
 * How long a download runs before this member is reported as still downloading the map. A map
 * already on disk resolves well within this, so checking one never flashes the indicator in front
 * of everyone in the lobby.
 */
const DOWNLOADING_REPORT_DELAY_MS = 300

/** How long one map status report may take before it's given up on. */
const REPORT_TIMEOUT_MS = 10_000

/**
 * The tail of every map status report this client has sent. Reports go out one at a time, in the
 * order they were made: a `downloading` report overtaken by the `ready` that followed it would
 * otherwise leave the server believing the download never finished.
 */
let reportQueue: Promise<void> = Promise.resolve()

function reportMapStatus(lobbyId: SbLobbyId, mapId: SbMapId, status: LobbyMapStatus) {
  reportQueue = reportQueue.then(() =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/map-status`, {
      method: 'POST',
      body: encodeBodyAsParams<SetLobbyMapStatusRequest>({ clientId, mapId, status }),
      // A report that never completes would hold up every one after it.
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    }).catch(err => {
      logger.error(`Error reporting lobby map status: ${getErrorStack(err)}`)
    }),
  )
}

/**
 * Downloads a lobby's current map, telling the lobby while it's taking a while and if it fails, so
 * the host can see who the game would be waiting on. Game loading refuses to proceed until the map
 * is on disk, so starting this as soon as the map is known keeps the countdown from having to
 * fetch it from scratch.
 *
 * `downloadingReportDelayMs` is how long to wait before reporting the download as in progress; a
 * retry passes 0, since the lobby is already showing that this member doesn't have the map.
 */
export function downloadLobbyMap(
  lobby: Pick<Lobby, 'id' | 'map'>,
  downloadingReportDelayMs = DOWNLOADING_REPORT_DELAY_MS,
): ThunkAction {
  return (_dispatch, getState) => {
    const lobbyId = lobby.id
    const { id: mapId, hash, mapData, mapUrl } = lobby.map!
    const download = ipcRenderer.invoke('mapStoreDownloadMap', hash, mapData.format, mapUrl!)
    if (!download) {
      return
    }

    let reportedDownloading = false
    const downloadingTimer = setTimeout(() => {
      reportedDownloading = true
      reportMapStatus(lobbyId, mapId, 'downloading')
    }, downloadingReportDelayMs)

    download.then(
      () => {
        clearTimeout(downloadingTimer)
        // The lobby records nothing for a member who has the map, so `ready` only needs sending to
        // take back a status this client reported before: this download's, or an earlier failure.
        const { auth, lobby: lobbyState } = getState()
        const selfId = auth.self?.user.id
        if (reportedDownloading || lobbyState.mapStatuses.some(entry => entry.userId === selfId)) {
          reportMapStatus(lobbyId, mapId, 'ready')
        }
      },
      (err: unknown) => {
        clearTimeout(downloadingTimer)
        // This is already logged to our file by the map store, so we just log it to the console for
        // easy visibility during development
        console.error('Error downloading map: ' + getErrorStack(err))
        // TODO(tec27): Have the server cancel a countdown or load that's already under way when
        // this arrives, rather than leaving the load to fail on its own
        reportMapStatus(lobbyId, mapId, 'failed')
      },
    )
  }
}

/** Tries downloading the current lobby's map again after an earlier attempt failed. */
export function retryLobbyMapDownload(): ThunkAction {
  return (dispatch, getState) => {
    const { lobby } = getState()
    if (!isInLobby(lobby) || !lobby.info.map) {
      return
    }

    dispatch(downloadLobbyMap(lobby.info, 0))
  }
}
