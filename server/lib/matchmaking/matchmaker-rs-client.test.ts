import http from 'node:http'
import { AddressInfo } from 'node:net'
import { Result } from 'typescript-result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import {
  MatchmakerClient,
  RS_REQUEST_TIMEOUT_MS,
  RsClientErrorCode,
  RsMatchmakerError,
} from './matchmaker-rs-client'

describe('matchmaking/matchmaker-rs-client', () => {
  let server: http.Server
  let requests: http.IncomingMessage[]
  let requestReceived: Deferred<void>
  let respond: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | undefined
  let previousUrl: string | undefined
  const client = new MatchmakerClient()

  beforeEach(async () => {
    requests = []
    requestReceived = createDeferred()
    respond = undefined
    server = http.createServer((req, res) => {
      requests.push(req)
      requestReceived.resolve()
      respond?.(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    previousUrl = process.env.SB_SERVER_RS_URL
    process.env.SB_SERVER_RS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.useRealTimers()
    process.env.SB_SERVER_RS_URL = previousUrl
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  test.each([
    { name: 'queue', send: () => client.queue(queueRequest()) },
    { name: 'cancel', send: () => client.cancel(makeSbUserId(1), 'search-1') },
    { name: 'requeue', send: () => client.requeue('ticket') },
    { name: 'process token', send: () => client.getProcessToken() },
  ])('fails a $name request the matchmaker never answers', async ({ send }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = Symbol('pending')
    const result = send()
    await requestReceived

    await vi.advanceTimersByTimeAsync(RS_REQUEST_TIMEOUT_MS)
    vi.useRealTimers()
    const settled = await Promise.race([
      result,
      new Promise<typeof pending>(resolve => setTimeout(() => resolve(pending), 500)),
    ])

    expect(settled).not.toBe(pending)
    const error = (settled as Result<unknown, RsMatchmakerError>).error
    expect(error?.code).toBe(RsClientErrorCode.ServiceUnavailable)
    expect(requests).toHaveLength(1)
  })

  test('names the search a removal is for', async () => {
    respond = (_req, res) => res.writeHead(204).end()

    const result = await client.cancel(makeSbUserId(1), 'search-1')

    expect(result.isOk()).toBe(true)
    expect(requests[0].method).toBe('DELETE')
    expect(requests[0].url).toBe('/matchmaker/1?searchId=search-1')
  })
})

function queueRequest() {
  return {
    id: makeSbUserId(1),
    searchId: 'search-1',
    modeRatings: [
      {
        mode: MatchmakingType.Match1v1,
        rating: 1500,
        uncertainty: 200,
        mapSelections: null,
        recentOpponents: [],
      },
    ],
  }
}
