import { SbMapId } from '../../common/maps'
import { LaunchSoloGameRequest } from '../../common/solo-games'
import { apiUrl } from '../../common/urls'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'

/**
 * Asks the server to launch a game on a map that the user plays alone, run by this client.
 * Succeeds once the game has begun loading; how the launch turns out arrives over the socket
 * (`/solo-games/:userId`).
 */
export function launchSoloGame(
  request: Omit<LaunchSoloGameRequest, 'clientId'>,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`solo-games`, {
      method: 'POST',
      // Sent as JSON so the slot arrives as a number
      body: JSON.stringify({ clientId, ...request } satisfies LaunchSoloGameRequest),
      signal: spec.signal,
    })
  })
}

/** Opens the dialog that sets up a game on `mapId` played alone, and starts it. */
export function openPlayAloneDialog(mapId: SbMapId) {
  return openDialog({ type: DialogType.PlayAlone, initData: { mapId } })
}
