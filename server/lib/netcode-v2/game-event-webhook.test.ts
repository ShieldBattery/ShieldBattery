import KoaRouter from '@koa/router'
import got from 'got'
import Koa from 'koa'
import { Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import log from '../logging/logger'
import { GAME_EVENT_BODY_SCHEMA, registerGameEventWebhookRoutes } from './game-event-webhook'
import {
  checkGameEventWebhookAuth,
  recordSlotConnectedEvidenceNotification,
  recordSlotConnectedNotification,
  recordSlotEvidenceNotification,
} from './netcode-v2-game-event-service'

const buckets = vi.hoisted(() => ({
  requests: vi.fn(),
  lifecycle: vi.fn(),
  periodic: vi.fn(),
}))

vi.mock('../throttle/create-throttle', () => ({
  default: (name: string) => {
    if (name === 'netcodeV2GameEventRequests') return { rateLimitWithWait: buckets.requests }
    if (name === 'netcodeV2PeriodicEvidence') return { rateLimitWithWait: buckets.periodic }
    return { rateLimitWithWait: buckets.lifecycle }
  },
}))
vi.mock('../logging/logger', () => ({ default: { warn: vi.fn() } }))
vi.mock('./netcode-v2-game-event-service', () => ({
  checkGameEventWebhookAuth: vi.fn(),
  recordSlotConnectedEvidenceNotification: vi.fn(),
  recordSlotConnectedNotification: vi.fn(),
  recordSlotEvidenceNotification: vi.fn(),
  recordDepartureNotification: vi.fn(),
  recordDesyncNotification: vi.fn(),
  recordLobbyViolationNotification: vi.fn(),
  recordResultNotification: vi.fn(),
  recordSessionClosedNotification: vi.fn(),
  recordSessionStartedNotification: vi.fn(),
  recordSlotStartedNotification: vi.fn(),
}))

const GAME_ID = '11111111-2222-4333-8444-555555555555'

describe('netcode-v2/GAME_EVENT_BODY_SCHEMA', () => {
  test('accepts a departure event', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'departure',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 0,
      externalRef: '42',
      kind: 'left',
      reason: 3,
      leaveSeq: 1,
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('departure')
  })

  test('accepts a desync event', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'desync',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      syncOrdinal: 17,
      gameFrame: 512,
      detectedAtMs: Date.now(),
      noMajority: false,
      diverged: [{ slot: 2, externalRef: '42' }],
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('desync')
  })

  test('accepts a no-majority desync event with an empty diverged array', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'desync',
      tenant: 'sb-dev',
      session: 1,
      syncOrdinal: 17,
      detectedAtMs: Date.now(),
      noMajority: true,
      diverged: [],
    })

    expect(error).toBeUndefined()
  })

  test('accepts a rollback desync event naming slots missing their reports', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'desync',
      tenant: 'sb-dev',
      session: 1,
      syncOrdinal: 16,
      detectedAtMs: Date.now(),
      noMajority: false,
      diverged: [],
      missing: [{ slot: 1, externalRef: '7' }],
    })

    expect(error).toBeUndefined()
    expect(value.missing).toEqual([{ slot: 1, externalRef: '7' }])
  })

  test('rejects a missing entry without a slot', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'desync',
      tenant: 'sb-dev',
      session: 1,
      syncOrdinal: 16,
      detectedAtMs: Date.now(),
      noMajority: false,
      diverged: [],
      missing: [{ externalRef: '7' }],
    })

    expect(error).toBeDefined()
  })

  test('rejects an unknown event discriminator', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'something-else',
      tenant: 'sb-dev',
      session: 1,
    })

    expect(error).toBeDefined()
  })

  test('rejects a body missing the event discriminator entirely', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      tenant: 'sb-dev',
      session: 1,
      slot: 0,
      kind: 'left',
      reason: 3,
      leaveSeq: 1,
    })

    expect(error).toBeDefined()
  })

  test('rejects a departure event missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'departure',
      tenant: 'sb-dev',
      session: 1,
      slot: 0,
      kind: 'left',
      // missing `reason` and `leaveSeq`
    })

    expect(error).toBeDefined()
  })

  test('rejects a desync event missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'desync',
      tenant: 'sb-dev',
      session: 1,
      syncOrdinal: 17,
      noMajority: false,
      // missing `detectedAtMs` and `diverged`
    })

    expect(error).toBeDefined()
  })

  test('accepts a result event', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'result',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 0,
      externalRef: '42',
      payload: Buffer.from('{"userId":42}', 'utf8').toString('base64'),
      arrivalMs: Date.now(),
      sessionFrame: 100,
      slotFrame: 99,
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('result')
  })

  test('rejects a result event missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'result',
      tenant: 'sb-dev',
      session: 1,
      slot: 0,
      // missing `payload` and `arrivalMs`
    })

    expect(error).toBeDefined()
  })

  test('rejects a result event whose slot is out of range', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'result',
      tenant: 'sb-dev',
      session: 1,
      slot: 16,
      payload: Buffer.from('{}', 'utf8').toString('base64'),
      arrivalMs: Date.now(),
    })

    expect(error).toBeDefined()
  })

  test('rejects a result event whose payload is not valid base64', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'result',
      tenant: 'sb-dev',
      session: 1,
      slot: 0,
      payload: 'not-valid-base64!!!',
      arrivalMs: Date.now(),
    })

    expect(error).toBeDefined()
  })

  test('rejects a result event whose payload exceeds the size cap', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'result',
      tenant: 'sb-dev',
      session: 1,
      slot: 0,
      payload: Buffer.alloc(6200).toString('base64'),
      arrivalMs: Date.now(),
    })

    expect(error).toBeDefined()
  })

  test('accepts a departure event with an embedded result', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'departure',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 0,
      externalRef: '42',
      kind: 'left',
      reason: 3,
      leaveSeq: 1,
      result: {
        payload: Buffer.from('{"userId":42}', 'utf8').toString('base64'),
        arrivalMs: Date.now(),
        sessionFrame: 100,
        slotFrame: 99,
      },
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('departure')
  })

  test('accepts a departure event without an embedded result', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'departure',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 0,
      kind: 'dropped',
      reason: 1,
      leaveSeq: 1,
    })

    expect(error).toBeUndefined()
  })

  test('rejects a departure event whose embedded result is missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'departure',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 0,
      kind: 'left',
      reason: 3,
      leaveSeq: 1,
      result: {
        // missing `payload` and `arrivalMs`
        sessionFrame: 100,
      },
    })

    expect(error).toBeDefined()
  })

  test('accepts a sessionClosed event', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'sessionClosed',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('sessionClosed')
  })

  test('accepts a sessionClosed event without externalId', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'sessionClosed',
      tenant: 'sb-dev',
      session: 1,
    })

    expect(error).toBeUndefined()
  })

  test('rejects a sessionClosed event missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'sessionClosed',
      externalId: GAME_ID,
      // missing `tenant` and `session`
    })

    expect(error).toBeDefined()
  })

  test('accepts a slotConnected event', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'slotConnected',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 0,
      externalRef: '42',
      resumed: false,
      connectedAtMs: Date.now(),
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('slotConnected')
  })

  test('rejects a slotConnected event missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'slotConnected',
      tenant: 'sb-dev',
      session: 1,
      slot: 0,
      // missing `resumed` and `connectedAtMs`
    })

    expect(error).toBeDefined()
  })

  test('rejects a slotConnected event whose slot is out of range', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'slotConnected',
      tenant: 'sb-dev',
      session: 1,
      slot: 16,
      resumed: false,
      connectedAtMs: Date.now(),
    })

    expect(error).toBeDefined()
  })

  test('accepts a sessionStarted event', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'sessionStarted',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      startedAtMs: Date.now(),
      initialBufferTurns: 3,
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('sessionStarted')
  })

  test('accepts a sessionStarted event without initialBufferTurns', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'sessionStarted',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      startedAtMs: Date.now(),
    })

    expect(error).toBeUndefined()
  })

  test('rejects a sessionStarted event missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'sessionStarted',
      tenant: 'sb-dev',
      session: 1,
      // missing `startedAtMs`
    })

    expect(error).toBeDefined()
  })

  test('rejects a sessionStarted event whose startedAtMs is out of range', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'sessionStarted',
      tenant: 'sb-dev',
      session: 1,
      startedAtMs: 10_000_000_000_001,
    })

    expect(error).toBeDefined()
  })

  test('accepts a slotStarted event', () => {
    const { error, value } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'slotStarted',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 2,
      externalRef: '42',
      arrivalMs: Date.now(),
      sessionFrame: 12,
      slotFrame: 11,
    })

    expect(error).toBeUndefined()
    expect(value.event).toBe('slotStarted')
  })

  test('accepts a slotStarted event without frame numbers', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'slotStarted',
      tenant: 'sb-dev',
      session: 1,
      externalId: GAME_ID,
      slot: 2,
      externalRef: '42',
      arrivalMs: Date.now(),
    })

    expect(error).toBeUndefined()
  })

  test('rejects a slotStarted event missing a required field', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'slotStarted',
      tenant: 'sb-dev',
      session: 1,
      slot: 2,
      // missing `arrivalMs`
    })

    expect(error).toBeDefined()
  })

  test('allows unknown extra fields on either variant (coordinator does not deny_unknown_fields)', () => {
    const { error } = GAME_EVENT_BODY_SCHEMA.validate({
      event: 'departure',
      tenant: 'sb-dev',
      session: 1,
      slot: 0,
      kind: 'left',
      reason: 3,
      leaveSeq: 1,
      somethingNew: 'value',
    })

    expect(error).toBeUndefined()
  })
})

describe('lobby violation schema', () => {
  const body = {
    event: 'lobbyViolation',
    tenant: 'sb-dev',
    session: 1,
    externalId: GAME_ID,
    slot: 1,
    externalRef: '42',
    arrivalMs: 123456,
  }
  test('accepts coordinator evidence', () => {
    expect(GAME_EVENT_BODY_SCHEMA.validate(body).error).toBeUndefined()
  })
  test.each([
    { slot: 16 },
    { slot: -1 },
    { slot: 1.5 },
    { arrivalMs: -1 },
    { arrivalMs: 10_000_000_000_001 },
    { arrivalMs: undefined },
    { session: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed evidence %j', override => {
    expect(GAME_EVENT_BODY_SCHEMA.validate({ ...body, ...override }).error).toBeDefined()
  })
})

describe('netcode-v2/game-event webhook HTTP routing', () => {
  let server: Server
  let url: string
  const evidence = {
    connectionId: Buffer.alloc(32, 1).toString('base64'),
    sampleId: 1,
    sequence: 2,
    assignmentRevision: 1,
    verdict: 'valid',
    keyId: 7,
    body: 'AP+A',
  }
  const periodic = {
    event: 'slotEvidence',
    tenant: 'sb-dev',
    session: 1,
    slot: 0,
    externalId: GAME_ID,
    observedAtMs: 123,
    evidence,
  }
  const lifecycle = {
    event: 'slotConnected',
    tenant: 'sb-dev',
    session: 1,
    slot: 0,
    externalId: GAME_ID,
    connectedAtMs: 123,
    resumed: false,
  }

  beforeEach(async () => {
    vi.resetAllMocks()
    buckets.requests.mockResolvedValue({ limited: false, waitMs: 0 })
    buckets.lifecycle.mockResolvedValue({ limited: false, waitMs: 0 })
    buckets.periodic.mockResolvedValue({ limited: false, waitMs: 0 })
    vi.mocked(checkGameEventWebhookAuth).mockResolvedValue(null)
    vi.mocked(recordSlotEvidenceNotification).mockResolvedValue('stored')
    vi.mocked(recordSlotConnectedEvidenceNotification).mockResolvedValue('stored')
    const app = new Koa()
    const router = new KoaRouter()
    registerGameEventWebhookRoutes(router)
    app.use(router.routes())
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/netcode-v2/game-events`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    })
  })

  function post(json: object) {
    return got.post(url, {
      json,
      throwHttpErrors: false,
      retry: { limit: 0 },
      headers: { 'x-rp2-timestamp': '123', 'x-rp2-signature': 'test-signature' },
    })
  }

  test('limits requests before parsing their JSON or checking signatures', async () => {
    buckets.requests.mockResolvedValue({ limited: true, waitMs: 2000 })
    for (const body of ['{invalid', JSON.stringify({ payload: 'x'.repeat(65536) })]) {
      const response = await got.post(url, {
        body,
        headers: { 'content-type': 'application/json' },
        throwHttpErrors: false,
        retry: { limit: 0 },
      })
      expect(response.statusCode).toBe(429)
    }
    expect(buckets.requests).toHaveBeenCalledTimes(2)
    expect(buckets.requests).toHaveBeenCalledWith('127.0.0.1')
    expect(checkGameEventWebhookAuth).not.toHaveBeenCalled()
    expect(buckets.lifecycle).not.toHaveBeenCalled()
    expect(buckets.periodic).not.toHaveBeenCalled()
  })

  test('exhausted lifecycle budget leaves periodic delivery available', async () => {
    buckets.lifecycle.mockResolvedValue({ limited: true, waitMs: 1000 })
    expect((await post(lifecycle)).statusCode).toBe(429)
    expect((await post(periodic)).statusCode).toBe(204)
    expect(checkGameEventWebhookAuth).toHaveBeenCalledTimes(2)
    expect(recordSlotConnectedNotification).not.toHaveBeenCalled()
    expect(recordSlotEvidenceNotification).toHaveBeenCalledExactlyOnceWith(periodic)
  })

  test.each([
    { verdict: 'future_verdict' },
    { verdict: 'missing', body: '', interruption: 'future_reason' },
    { verdict: 'invalid' },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { body: Buffer.alloc(4029).toString('base64') },
    { connectionId: '' },
    { sampleId: 1 },
  ])('records connections despite malformed or unsupported evidence %j', async overrides => {
    const connection = {
      ...lifecycle,
      evidence: { ...evidence, sampleId: 0, ...overrides },
    }
    expect((await post(connection)).statusCode).toBe(204)
    expect(recordSlotConnectedNotification).toHaveBeenCalledExactlyOnceWith(lifecycle)
    expect(recordSlotConnectedEvidenceNotification).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  test.each(['stored', 'pending'] as const)(
    'records valid connection evidence with a %s persistence result',
    async result => {
      vi.mocked(recordSlotConnectedEvidenceNotification).mockResolvedValue(result)
      const connection = { ...lifecycle, evidence: { ...evidence, sampleId: 0 } }
      expect((await post(connection)).statusCode).toBe(result === 'pending' ? 503 : 204)
      expect(recordSlotConnectedNotification).toHaveBeenCalledExactlyOnceWith(lifecycle)
      expect(recordSlotConnectedEvidenceNotification).toHaveBeenCalledExactlyOnceWith(connection)
      expect(log.warn).not.toHaveBeenCalled()
    },
  )

  test.each([undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])(
    'drops periodic observations without a valid positive sample ID: %s',
    async sampleId => {
      expect((await post({ ...periodic, evidence: { ...evidence, sampleId } })).statusCode).toBe(
        204,
      )
      expect(recordSlotEvidenceNotification).not.toHaveBeenCalled()
    },
  )

  test('forwards valid historical metadata without changing its cumulative count', async () => {
    const history = {
      ...periodic,
      historical: true,
      failureCount: 0xffffffff,
      evidence: { ...evidence, verdict: 'missing', body: '', interruption: 'connection_closed' },
    }
    expect((await post(history)).statusCode).toBe(204)
    expect(recordSlotEvidenceNotification).toHaveBeenCalledExactlyOnceWith(history)
    vi.mocked(recordSlotEvidenceNotification).mockClear()
    for (const overrides of [
      { failureCount: 0 },
      { failureCount: -1 },
      { failureCount: 0x100000000 },
      { failureCount: 1.5 },
      { failureCount: '1' },
      { historical: 'true' },
      { historical: false },
      { evidence: { ...history.evidence, interruption: 'revoked' } },
      { evidence: { ...history.evidence, interruption: 'session_retired' } },
      { evidence: { ...history.evidence, verdict: 'valid', keyId: 1 } },
    ]) {
      expect((await post({ ...history, ...overrides })).statusCode).toBe(204)
    }
    expect(recordSlotEvidenceNotification).not.toHaveBeenCalled()
  })

  test('exhausted periodic budget leaves lifecycle delivery available', async () => {
    buckets.periodic
      .mockResolvedValueOnce({ limited: false, waitMs: 0 })
      .mockResolvedValue({ limited: true, waitMs: 1000 })
    expect((await post(periodic)).statusCode).toBe(204)
    const limited = await post(periodic)
    expect(limited.statusCode).toBe(429)
    expect((await post(lifecycle)).statusCode).toBe(204)
    expect(buckets.periodic).toHaveBeenCalledTimes(2)
    expect(buckets.lifecycle).toHaveBeenCalledExactlyOnceWith('127.0.0.1')
    expect(recordSlotEvidenceNotification).toHaveBeenCalledTimes(1)
    expect(recordSlotConnectedNotification).toHaveBeenCalledExactlyOnceWith(lifecycle)
    expect(recordSlotConnectedEvidenceNotification).not.toHaveBeenCalled()
  })

  test('acknowledges an unsupported authenticated sample without affecting lifecycle delivery', async () => {
    const future = {
      ...periodic,
      evidence: { ...evidence, verdict: 'missing', body: '', interruption: 'future_reason' },
    }
    expect((await post(future)).statusCode).toBe(204)
    expect(recordSlotEvidenceNotification).not.toHaveBeenCalled()
    expect((await post(lifecycle)).statusCode).toBe(204)
    expect(recordSlotConnectedNotification).toHaveBeenCalledExactlyOnceWith(lifecycle)
    expect(checkGameEventWebhookAuth).toHaveBeenCalledTimes(2)
  })

  test('keeps the observation envelope strict and forwards valid timestamps', async () => {
    expect((await post({ ...periodic, observedAtMs: 8_640_000_000_000_001 })).statusCode).toBe(400)
    expect((await post({ ...periodic, session: -1 })).statusCode).toBe(400)
    expect(recordSlotEvidenceNotification).not.toHaveBeenCalled()
    expect((await post(periodic)).statusCode).toBe(204)
    expect(recordSlotEvidenceNotification).toHaveBeenCalledExactlyOnceWith(periodic)
  })

  test('neither bucket bypasses signature verification or exposes schema errors first', async () => {
    vi.mocked(checkGameEventWebhookAuth).mockResolvedValue(401)
    for (const body of [periodic, lifecycle, { event: 'slotEvidence' }]) {
      expect((await post(body)).statusCode).toBe(401)
      expect(checkGameEventWebhookAuth).toHaveBeenLastCalledWith(
        '123',
        'test-signature',
        Buffer.from(JSON.stringify(body)),
      )
    }
    expect(buckets.requests).toHaveBeenCalledTimes(3)
    expect(buckets.periodic).not.toHaveBeenCalled()
    expect(buckets.lifecycle).not.toHaveBeenCalled()
    expect(recordSlotEvidenceNotification).not.toHaveBeenCalled()
    expect(recordSlotConnectedNotification).not.toHaveBeenCalled()
    expect(recordSlotConnectedEvidenceNotification).not.toHaveBeenCalled()
  })
})
