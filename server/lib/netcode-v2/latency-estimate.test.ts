import { afterEach, describe, expect, test, vi } from 'vitest'
import { BackboneRttTable, worstPairwiseLatencyMs } from './latency-estimate'

describe('netcode-v2/BackboneRttTable', () => {
  test('same region is always zero, even for a region present in the table', () => {
    const table = new BackboneRttTable([['us-east|eu-west', 90]])
    expect(table.rtt('us-east', 'us-east')).toBe(0)
    expect(table.rtt('eu-west', 'eu-west')).toBe(0)
  })

  test('a known pair looks up the same value regardless of argument order', () => {
    const table = new BackboneRttTable([['us-east|eu-west', 90]])
    expect(table.rtt('us-east', 'eu-west')).toBe(90)
    expect(table.rtt('eu-west', 'us-east')).toBe(90)
  })

  test('a config key written in either order canonicalizes the same', () => {
    // "eu-west|us-east" is not sorted; it must canonicalize to the same key as the sorted form.
    const table = new BackboneRttTable([['eu-west|us-east', 90]])
    expect(table.rtt('us-east', 'eu-west')).toBe(90)
    expect(table.rtt('eu-west', 'us-east')).toBe(90)
  })

  test('an unconfigured pair falls back to the conservative default', () => {
    const table = new BackboneRttTable([['us-east|eu-west', 90]])
    expect(table.rtt('us-east', 'ap-south')).toBe(150)
  })

  test('an empty table uses the default for every cross-region pair', () => {
    const table = new BackboneRttTable()
    expect(table.rtt('us-east', 'eu-west')).toBe(150)
    expect(table.rtt('us-east', 'us-east')).toBe(0)
  })

  test('fromJson parses the object form', () => {
    const table = BackboneRttTable.fromJson(
      JSON.stringify({ 'us-east|eu-west': 90, 'us-east|ap-south': 200 }),
    )
    expect(table.rtt('eu-west', 'us-east')).toBe(90)
    expect(table.rtt('ap-south', 'us-east')).toBe(200)
    expect(table.rtt('eu-west', 'ap-south')).toBe(150)
  })

  test('a malformed key is dropped rather than failing the whole table', () => {
    const table = new BackboneRttTable([
      ['us-east', 10],
      ['a|b|c', 20],
      ['us-east|eu-west', 90],
    ])
    expect(table.rtt('us-east', 'eu-west')).toBe(90)
  })

  describe('fromEnv', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    test('reads the table from SB_REGION_BACKBONE_RTT_JSON', () => {
      vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 90 }))
      const table = BackboneRttTable.fromEnv()
      expect(table.rtt('us-east', 'eu-west')).toBe(90)
    })

    test('falls back to an empty table when the variable is unset', () => {
      const table = BackboneRttTable.fromEnv()
      expect(table.rtt('us-east', 'eu-west')).toBe(150)
    })

    test('falls back to an empty table when the variable is unparseable', () => {
      vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', 'not json')
      const table = BackboneRttTable.fromEnv()
      expect(table.rtt('us-east', 'eu-west')).toBe(150)
    })
  })

  describe('build', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    test('a served-only pair (no env override) uses the served value', () => {
      const table = BackboneRttTable.build(new Map([['us-east|eu-west', 90]]))
      expect(table.rtt('us-east', 'eu-west')).toBe(90)
    })

    test('an env-only pair (no served entry) uses the env value', () => {
      vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 90 }))
      const table = BackboneRttTable.build()
      expect(table.rtt('us-east', 'eu-west')).toBe(90)
    })

    test('an env override wins over a served value for the same pair', () => {
      vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 10 }))
      const table = BackboneRttTable.build(new Map([['us-east|eu-west', 90]]))
      expect(table.rtt('us-east', 'eu-west')).toBe(10)
    })

    test('a pair in neither source falls back to the conservative default', () => {
      vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 90 }))
      const table = BackboneRttTable.build(new Map([['us-east|ap-south', 80]]))
      expect(table.rtt('eu-west', 'ap-south')).toBe(150)
    })

    test('a served pair not named by the env override is unaffected by it', () => {
      vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|ap-south': 10 }))
      const table = BackboneRttTable.build(new Map([['us-east|eu-west', 90]]))
      expect(table.rtt('us-east', 'eu-west')).toBe(90)
      expect(table.rtt('us-east', 'ap-south')).toBe(10)
    })

    test('an empty served base with no env override yields the default for every pair', () => {
      const table = BackboneRttTable.build()
      expect(table.rtt('us-east', 'eu-west')).toBe(150)
    })
  })
})

describe('netcode-v2/worstPairwiseLatencyMs', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('a same-region pair is rtt halves only', () => {
    // rtt_a/2 + backbone(region, region)/2 + rtt_b/2 = 15 + 0 + 25 = 40ms.
    const result = worstPairwiseLatencyMs([
      { region: 'us-east', rttMs: 30 },
      { region: 'us-east', rttMs: 50 },
    ])
    expect(result).toBe(40)
  })

  test('a cross-region pair uses the configured backbone table entry', () => {
    vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 90 }))
    // rtt_a/2 + backbone/2 + rtt_b/2 = 10 + 45 + 20 = 75ms.
    const result = worstPairwiseLatencyMs([
      { region: 'us-east', rttMs: 20 },
      { region: 'eu-west', rttMs: 40 },
    ])
    expect(result).toBe(75)
  })

  test('a cross-region pair with no table entry uses the conservative default', () => {
    // No backbone entry for this pair, so the default (150ms) applies:
    // rtt_a/2 + 150/2 + rtt_b/2 = 10 + 75 + 20 = 105ms.
    const result = worstPairwiseLatencyMs([
      { region: 'us-east', rttMs: 20 },
      { region: 'ap-south', rttMs: 40 },
    ])
    expect(result).toBe(105)
  })

  test('a cross-region pair uses the served backbone table entry when no env override names it', () => {
    // rtt_a/2 + backbone/2 + rtt_b/2 = 10 + 45 + 20 = 75ms.
    const result = worstPairwiseLatencyMs(
      [
        { region: 'us-east', rttMs: 20 },
        { region: 'eu-west', rttMs: 40 },
      ],
      new Map([['us-east|eu-west', 90]]),
    )
    expect(result).toBe(75)
  })

  test('an env override wins over a served entry for the same pair', () => {
    vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 10 }))
    // The env override (10) wins over the served value (90): 10 + 5 + 20 = 35ms.
    const result = worstPairwiseLatencyMs(
      [
        { region: 'us-east', rttMs: 20 },
        { region: 'eu-west', rttMs: 40 },
      ],
      new Map([['us-east|eu-west', 90]]),
    )
    expect(result).toBe(35)
  })

  test('is undefined when neither player carries a latency signal', () => {
    const result = worstPairwiseLatencyMs([{}, {}])
    expect(result).toBeUndefined()
  })

  test('skips a pair where one player has no region, leaving no computable pair', () => {
    vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 90 }))
    const result = worstPairwiseLatencyMs([{ region: 'us-east', rttMs: 20 }, { rttMs: 1000 }])
    expect(result).toBeUndefined()
  })

  test('skips a pair where one player has no measured rtt', () => {
    const result = worstPairwiseLatencyMs([{ region: 'us-east', rttMs: 20 }, { region: 'eu-west' }])
    expect(result).toBeUndefined()
  })

  test('is undefined for an empty roster or a single player', () => {
    expect(worstPairwiseLatencyMs([])).toBeUndefined()
    expect(worstPairwiseLatencyMs([{ region: 'us-east', rttMs: 20 }])).toBeUndefined()
  })

  test('mixed missing data still finds the worst computable pair among three players', () => {
    // Player 0 <-> 1 is the only fully-observed pair (both region + rtt); player 2 has no region and
    // must be skipped from every pair it's in.
    // one_way(0,1) = 20/2 + 0 (same region) + 200/2 = 10 + 0 + 100 = 110ms.
    const result = worstPairwiseLatencyMs([
      { region: 'us-east', rttMs: 20 },
      { region: 'us-east', rttMs: 200 },
      { rttMs: 5 },
    ])
    expect(result).toBe(110)
  })

  test('the worst pair wins across more than two players in the same region', () => {
    // Four players home in "us-east": three at 20ms, one at 200ms. Same region, so every pair's
    // backbone term is 0. The worst link is any pair involving the 200ms player:
    // 20/2 + 0 + 200/2 = 10 + 0 + 100 = 110ms.
    const result = worstPairwiseLatencyMs([
      { region: 'us-east', rttMs: 20 },
      { region: 'us-east', rttMs: 20 },
      { region: 'us-east', rttMs: 200 },
      { region: 'us-east', rttMs: 20 },
    ])
    expect(result).toBe(110)
  })
})
