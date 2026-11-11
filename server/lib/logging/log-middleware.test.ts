import { IncomingMessage, ServerResponse } from 'http'
import { describe, expect, test } from 'vitest'
import { getRequestLogLevel } from './log-middleware'

function levelFor(method: string, url: string, statusCode: number, err?: Error) {
  return getRequestLogLevel(
    { method, url } as IncomingMessage,
    { statusCode } as ServerResponse,
    err,
  )
}

describe('logging/log-middleware/getRequestLogLevel', () => {
  test('logs ordinary requests', () => {
    expect(levelFor('GET', '/api/1/users/1', 200)).toBe('info')
    expect(levelFor('POST', '/api/1/matchmaking/find', 204)).toBe('info')
  })

  test('skips successful loads of a current map pool', () => {
    expect(levelFor('GET', '/api/1/matchmaking-map-pools/1v1/current', 200)).toBe('silent')
    expect(levelFor('GET', '/api/1/matchmaking-map-pools/2v2/current?cache=1', 200)).toBe('silent')
  })

  test('skips successful game event deliveries', () => {
    expect(levelFor('POST', '/webhooks/netcode-v2/game-events', 204)).toBe('silent')
  })

  test('logs routine requests that fail', () => {
    expect(levelFor('GET', '/api/1/matchmaking-map-pools/1v1/current', 404)).toBe('info')
    expect(levelFor('POST', '/webhooks/netcode-v2/game-events', 401)).toBe('info')
    expect(levelFor('POST', '/webhooks/netcode-v2/game-events', 500)).toBe('info')
    expect(
      levelFor('POST', '/webhooks/netcode-v2/game-events', 200, new Error('stream closed')),
    ).toBe('info')
  })

  test('logs other requests to the same resources', () => {
    expect(levelFor('GET', '/api/1/matchmaking-map-pools/1v1', 200)).toBe('info')
    expect(levelFor('POST', '/api/1/matchmaking-map-pools/1v1', 200)).toBe('info')
    expect(levelFor('GET', '/webhooks/netcode-v2/game-events', 200)).toBe('info')
  })
})
