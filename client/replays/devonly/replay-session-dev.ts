/**
 * Wires up a console helper for driving `DevReplaySessionApi` from the renderer's devtools, so a
 * multi-client replay playback over a netcode v2 relay can be started by hand while testing the
 * game DLL. Only loaded in development Electron builds.
 */
import { TypedIpcRenderer } from '../../../common/ipc'
import { apiUrl } from '../../../common/urls'
import { resolveDesiredRegion } from '../../game-server-regions/region-resolution'
import { clientId } from '../../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../../network/fetch'

declare global {
  interface Window {
    __sbDevReplaySession?: (sessionId: string, replayPath: string, size: number) => Promise<unknown>
  }
}

const ipcRenderer = new TypedIpcRenderer()

window.__sbDevReplaySession = async (sessionId: string, replayPath: string, size: number) => {
  // The same inputs a lobby join reports: the session keypair's public half and the home region
  // the coordinator places this client's relay in.
  const [clientPubkey, desiredRegion] = await Promise.all([
    ipcRenderer.invoke('activeGameGenNetcodeV2SessionKeys'),
    resolveDesiredRegion().catch(() => undefined),
  ])
  return fetchJson(apiUrl`dev/replay-sessions/${sessionId}/join`, {
    method: 'POST',
    body: encodeBodyAsParams({
      clientId,
      clientPubkey,
      replayPath,
      size,
      region: desiredRegion?.region,
      rttMs: desiredRegion?.rttMs ?? undefined,
      regionManual: desiredRegion?.manual,
    }),
  })
}
