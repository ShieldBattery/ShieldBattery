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
