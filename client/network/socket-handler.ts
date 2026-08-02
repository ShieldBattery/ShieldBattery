import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'

/** Everything a handler may need; each one destructures the part it uses. */
export interface SocketHandlerParams {
  siteSocket: NydusClient
  ipcRenderer: TypedIpcRenderer
}

/**
 * Registers routes and listeners for one feature. Lives apart from the modules that collect these
 * so that a handler collection can name the type without importing the collector that loads it.
 */
export type SocketHandler = (params: SocketHandlerParams) => void
