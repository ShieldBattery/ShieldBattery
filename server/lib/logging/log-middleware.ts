import { IncomingMessage, ServerResponse } from 'http'
import koaPino from 'koa-pino-logger'
import { LevelWithSilent } from 'pino'
import { BASE_API_PATH } from '../http/http-api'
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

/**
 * Returns whether a request is one that arrives constantly and looks the same every time, so that
 * a line for each one that succeeds says nothing:
 *
 * - Loading a matchmaking type's current map pool, which every client does for every type each
 *   time it opens the Play screen.
 * - The relay coordinator's game event deliveries, which arrive many times per game. Their
 *   handlers log the notable events (results, departures, desyncs) themselves.
 */
function isRoutineRequest(req: IncomingMessage): boolean {
  const path = (req.url ?? '').split('?', 1)[0]
  switch (req.method) {
    case 'GET':
      return path.startsWith(`${BASE_API_PATH}/matchmaking-map-pools/`) && path.endsWith('/current')
    case 'POST':
      return path === '/webhooks/netcode-v2/game-events'
    default:
      return false
  }
}

/**
 * Returns the level a completed request is logged at. Routine requests are logged only when they
 * fail, since that is the only time one of them differs from the rest. Metrics still count every
 * request.
 */
export function getRequestLogLevel(
  req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): LevelWithSilent {
  return !err && res.statusCode < 400 && isRoutineRequest(req) ? 'silent' : 'info'
}

export default function logMiddleware() {
  return koaPino(
    {
      ...getLoggerOptions(),
      autoLogging: { ignore: isUnloggedRequest },
      customLogLevel: getRequestLogLevel,
    },
    getLoggerTransports(),
  )
}
