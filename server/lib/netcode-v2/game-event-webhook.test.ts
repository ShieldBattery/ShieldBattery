import { describe, expect, test } from 'vitest'
import { GAME_EVENT_BODY_SCHEMA } from './game-event-webhook'

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
