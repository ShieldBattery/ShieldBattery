import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'fs'
import got from 'got'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import {
  InternalApiTestServer,
  startInternalApiTestServer,
} from '../http/testing/internal-api-server'
import { BanEnacter } from './ban-enacter'
import { BanRequestConflict } from './ban-request-models'
import { InternalUserApi } from './internal-user-api'

const REQUEST = {
  requestId: '11111111-2222-4333-8444-555555555555',
  endTime: '9001-01-01T00:00:00.000Z',
  reason: 'Account policy violation',
}
const TOKEN = 'ab'.repeat(32)
const OPTIONS = {
  throwHttpErrors: false,
  retry: { limit: 0 },
  headers: { authorization: `Bearer ${TOKEN}` },
}

describe('internal user bans', () => {
  let server: InternalApiTestServer
  let directory: string
  let tokenFile: string
  const enactBanRequest = vi.fn()
  beforeEach(async () => {
    enactBanRequest.mockReset().mockResolvedValue('ban-id')
    directory = mkdtempSync(path.join(os.tmpdir(), 'sb-moderation-auth-'))
    tokenFile = path.join(directory, 'token')
    writeFileSync(tokenFile, `${TOKEN}\n`)
    vi.stubEnv('SB_MODERATION_SERVICE_TOKEN_FILE', tokenFile)
    server = await startInternalApiTestServer([
      new InternalUserApi({ enactBanRequest } as unknown as BanEnacter),
    ])
  })
  afterEach(async () => {
    await server.close()
    vi.unstubAllEnvs()
    unlinkSync(tokenFile)
    rmdirSync(directory)
  })

  test('accepts a direct private request and returns the durable receipt', async () => {
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      json: REQUEST,
    })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ requestId: REQUEST.requestId, banId: 'ban-id' })
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(enactBanRequest).toHaveBeenCalledWith({
      requestId: REQUEST.requestId,
      targetId: makeSbUserId(7),
      endTime: new Date(REQUEST.endTime),
      reason: REQUEST.reason,
    })
  })

  test('accepts version 8 request IDs', async () => {
    const requestId = '11111111-2222-8333-8444-555555555555'
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      json: { ...REQUEST, requestId },
    })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).requestId).toBe(requestId)
  })

  test('rejects forwarded requests before parsing or applying the ban', async () => {
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      headers: {
        ...OPTIONS.headers,
        'x-forwarded-for': '127.0.0.1',
        'content-type': 'application/json',
      },
      body: 'invalid json',
    })
    expect(response.statusCode).toBe(403)
    expect(enactBanRequest).not.toHaveBeenCalled()
  })

  test.each([
    ['missing', ''],
    ['wrong', `Bearer ${'cd'.repeat(32)}`],
    ['malformed', `Basic ${TOKEN}`],
    ['oversized', `Bearer ${'a'.repeat(1000)}`],
  ])('rejects %s credentials before parsing JSON', async (_, authorization) => {
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      headers: { authorization, 'content-type': 'application/json' },
      body: 'invalid json',
    })
    expect(response.statusCode).toBe(401)
    expect(enactBanRequest).not.toHaveBeenCalled()
  })

  test.each(['missing', 'unreadable', 'malformed'])(
    'fails closed for %s token configuration',
    async kind => {
      await server.close()
      if (kind === 'missing') vi.stubEnv('SB_MODERATION_SERVICE_TOKEN_FILE', undefined)
      else if (kind === 'unreadable')
        vi.stubEnv('SB_MODERATION_SERVICE_TOKEN_FILE', path.join(directory, 'absent'))
      else writeFileSync(tokenFile, 'weak')
      server = await startInternalApiTestServer([
        new InternalUserApi({ enactBanRequest } as unknown as BanEnacter),
      ])
      const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
        ...OPTIONS,
        json: REQUEST,
      })
      expect(response.statusCode).toBe(401)
      expect(enactBanRequest).not.toHaveBeenCalled()
    },
  )

  test('loads the capability once for the API lifetime', async () => {
    writeFileSync(tokenFile, 'changed after startup')
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      json: REQUEST,
    })
    expect(response.statusCode).toBe(200)
  })

  test.each([
    ['request ID', { ...REQUEST, requestId: 'invalid' }],
    ['date', { ...REQUEST, endTime: 'yesterday' }],
    ['empty reason', { ...REQUEST, reason: '' }],
    ['long reason', { ...REQUEST, reason: 'a'.repeat(1001) }],
    ['unknown field', { ...REQUEST, extra: true }],
    ['missing field', { requestId: REQUEST.requestId }],
  ])('rejects invalid %s', async (_, json) => {
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, { ...OPTIONS, json })
    expect(response.statusCode).toBe(400)
    expect(enactBanRequest).not.toHaveBeenCalled()
  })

  test.each(['0', '-1', '2147483648', 'abc'])('rejects invalid user ID %s', async userId => {
    const response = await got.post(`${server.baseUrl}/internal/users/${userId}/ban`, {
      ...OPTIONS,
      json: REQUEST,
    })
    expect(response.statusCode).toBe(400)
    expect(enactBanRequest).not.toHaveBeenCalled()
  })

  test('bounds the parsed body', async () => {
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      json: { ...REQUEST, reason: 'a'.repeat(9000) },
    })
    expect(response.statusCode).toBe(413)
    expect(enactBanRequest).not.toHaveBeenCalled()
  })

  test('requires JSON', async () => {
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      form: REQUEST,
    })
    expect(response.statusCode).toBe(415)
    expect(enactBanRequest).not.toHaveBeenCalled()
  })

  test('returns a conflict for a reused request with different contents', async () => {
    enactBanRequest.mockRejectedValue(new BanRequestConflict('Request conflict'))
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      json: REQUEST,
    })
    expect(response.statusCode).toBe(409)
  })

  test('does not acknowledge failed cleanup', async () => {
    enactBanRequest.mockRejectedValue(new Error('Cleanup failed'))
    const response = await got.post(`${server.baseUrl}/internal/users/7/ban`, {
      ...OPTIONS,
      json: REQUEST,
    })
    expect(response.statusCode).toBe(500)
  })
})
