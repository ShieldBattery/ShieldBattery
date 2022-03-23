import { ServerConfig } from '../common/server-config'
import { JsonLocalStorageValue } from './local-storage'
import { getServerOrigin } from './network/server-url'

const serverOrigin = getServerOrigin().toLowerCase()
export const serverConfig = new JsonLocalStorageValue<ServerConfig>(`${serverOrigin}:serverConfig`)
