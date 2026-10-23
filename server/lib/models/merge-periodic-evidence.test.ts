import { describe, expect, test } from 'vitest'
import { NetcodeV2SlotEvidence } from '../../../common/games/netcode-v2'
import { mergePeriodicEvidence } from './merge-periodic-evidence'

function entry(slot: number): NetcodeV2SlotEvidence {
  return {
    slot,
    observation: {
      sampleId: 7,
      connectionId: Buffer.alloc(32, slot + 1).toString('base64'),
      sequence: slot + 1,
      assignmentRevision: 3,
      verdict: 'missing',
      body: '',
    },
  }
}

describe('mergePeriodicEvidence', () => {
  test('preserves independent slots, connections, and samples', () => {
    const first = entry(0)
    const observations = [
      first,
      entry(1),
      { ...first, observation: { ...first.observation, sampleId: 8 } },
      {
        ...first,
        observation: { ...first.observation, connectionId: Buffer.alloc(32, 9).toString('base64') },
      },
    ]
    expect(mergePeriodicEvidence(observations)).toEqual({ observations, conflicts: [] })
  })

  test('merges history metadata and takes the highest count regardless of delivery order', () => {
    const first = entry(0)
    const historical = {
      ...first,
      historical: true,
      failureCount: 8,
      observedAtMs: 123456789,
      observation: { ...first.observation, interruption: 'connection_closed' as const },
    }
    for (const observations of [
      [first, historical, { ...historical, failureCount: 3 }],
      [{ ...historical, failureCount: 3 }, historical, first],
    ]) {
      const original = structuredClone(observations)
      expect(mergePeriodicEvidence(observations)).toEqual({
        observations: [historical],
        conflicts: [],
      })
      expect(observations).toEqual(original)
    }
  })

  test.each([
    { sequence: 999 },
    { assignmentRevision: 999 },
    { verdict: 'invalid' as const },
    { keyId: 999 },
    { body: 'AQ==' },
    { interruption: 'timeout' as const },
  ])('discards only the conflicting identity, including later copies: %j', overrides => {
    const first = entry(0)
    first.observation.interruption = 'connection_closed'
    const independent = entry(1)
    expect(
      mergePeriodicEvidence([
        first,
        { ...first, observation: { ...first.observation, ...overrides } },
        first,
        independent,
      ]),
    ).toEqual({
      observations: [independent],
      conflicts: [`0:${first.observation.connectionId}:7`],
    })
  })

  test('keeps the first known timestamp while accepting later history enrichment', () => {
    const first = entry(0)
    expect(
      mergePeriodicEvidence([
        first,
        { ...first, observedAtMs: 1000 },
        { ...first, observedAtMs: 2000, historical: true, failureCount: 4 },
        first,
      ]),
    ).toEqual({
      observations: [{ ...first, observedAtMs: 1000, historical: true, failureCount: 4 }],
      conflicts: [],
    })
  })
})
