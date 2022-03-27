import { ServerConfig } from '../common/server-config'
import { JsonLocalStorageValue } from './local-storage'
import { baseUrl } from './network/server-base-url'

const localStorageKey = IS_ELECTRON ? `${baseUrl}:serverConfig` : 'serverConfig'
export const serverConfig = new JsonLocalStorageValue<ServerConfig>(localStorageKey)
