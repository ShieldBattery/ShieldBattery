import { IncomingMessage } from 'http'
import koaPino from 'koa-pino-logger'
import { isApprovedCorsPreflight } from '../security/cors'
import { getLoggerOptions, getLoggerTransports } from './logger'

/**
 * Prefixes of requests that carry client code and assets rather than anything the server does.
 *
 * The client is served as hundreds of small modules, so a line each buries everything worth
 * reading, and a browser's network panel shows them better than a log ever will. Only development
 * and test environments see these requests at all: a deployment serves its public assets from a
 * CDN, and reaches the server only for the shell and the API.
 */
const CLIENT_ASSET_PREFIXES = [
  // `server/public`, which is served from the root when the file store is the local filesystem.
  '/fonts/',
  '/images/',
  '/locales/',
  '/scripts/',
  '/videos/',
  // Source served as modules by the dev server, plus the endpoints it answers itself
  // (`/@vite/client`, `/@react-refresh`, `/@fs/`, `/@id/`).
  '/@',
  '/client/',
  '/common/',
  '/node_modules/',
]

function isClientAssetRequest(req: IncomingMessage): boolean {
  const url = req.url ?? ''
  return CLIENT_ASSET_PREFIXES.some(prefix => url.startsWith(prefix))
}

/**
 * Returns whether a request is left out of the log. Besides client assets, that covers the CORS
 * preflights we approve: the app sends one ahead of most API requests, each is immediately followed
 * by the request it asked about, and metrics still count them by method. Preflights from origins
 * we don't allow are rare and worth seeing, so those are still logged.
 */
function isUnloggedRequest(req: IncomingMessage): boolean {
  return isClientAssetRequest(req) || isApprovedCorsPreflight(req)
}

export default function logMiddleware() {
  return koaPino(
    { ...getLoggerOptions(), autoLogging: { ignore: isUnloggedRequest } },
    getLoggerTransports(),
  )
}
