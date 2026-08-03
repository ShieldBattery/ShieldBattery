import koaPino from 'koa-pino-logger'
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

function isClientAssetRequest(req) {
  const url = req.url ?? ''
  return CLIENT_ASSET_PREFIXES.some(prefix => url.startsWith(prefix))
}

export default function logMiddleware() {
  return koaPino(
    { ...getLoggerOptions(), autoLogging: { ignore: isClientAssetRequest } },
    getLoggerTransports(),
  )
}
