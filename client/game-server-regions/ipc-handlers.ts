import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import { gameServerRegionLatenciesAtom } from './game-server-regions-atoms'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer.on('gameServerRegionsLatenciesUpdated', (event, latencies) => {
    jotaiStore.set(gameServerRegionLatenciesAtom, latencies)
  })

  ipcRenderer
    .invoke('gameServerRegionsGetLatencies')
    ?.then(latencies => {
      jotaiStore.set(gameServerRegionLatenciesAtom, latencies)
    })
    .catch(swallowNonBuiltins)
}
