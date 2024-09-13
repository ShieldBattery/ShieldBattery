import { ServerConfig } from '../common/server-config.js'
import { JsonLocalStorageValue } from './local-storage.js'
import { baseUrl } from './network/server-base-url.js'

const FALLBACK_SERVER_CONFIG: ServerConfig = {
  publicAssetsUrl: 'https://cdn.shieldbattery.net/public/',
  graphqlOrigin: 'https://gql.shieldbattery.net/',
}

const localStorageKey = IS_ELECTRON ? `${baseUrl}~serverConfig` : 'serverConfig'
const serverConfig = new JsonLocalStorageValue<ServerConfig>(localStorageKey)

export function setServerConfig(config: ServerConfig) {
  serverConfig.setValue(config)
}

export function getServerConfig(): ServerConfig {
  return serverConfig.getValue() ?? FALLBACK_SERVER_CONFIG
}
