import log from '../logging/logger'

/** Environment variable holding the backbone table as a JSON object of `"id_a|id_b": rtt_ms` pairs. */
const BACKBONE_ENV_VAR = 'SB_REGION_BACKBONE_RTT_JSON'

/**
 * Round-trip time (ms) assumed for a region pair with no entry in the table. Conservative so an
 * unconfigured cross-region pair reads as fairly distant rather than free — an operator who wants a
 * cheaper estimate must state it explicitly.
 */
const DEFAULT_BACKBONE_RTT_MS = 150

/**
 * Canonicalizes an ordered id pair into the table's key form: the two ids sorted and joined by
 * `'|'`, so a lookup is independent of the order the two ids are passed.
 */
function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Parses a raw config key (`"id_a|id_b"`) into a canonical key, or undefined if it isn't exactly
 * two `'|'`-separated ids.
 */
function canonicalizeConfigKey(raw: string): string | undefined {
  const parts = raw.split('|')
  return parts.length === 2 ? pairKey(parts[0], parts[1]) : undefined
}

/**
 * A static table of region-to-region backbone round-trip times (ms), operator-supplied via
 * `SB_REGION_BACKBONE_RTT_JSON`. A pair paired with itself is always 0; a pair absent from the
 * table falls back to `DEFAULT_BACKBONE_RTT_MS`. Keys are canonicalized as the two region ids
 * sorted lexicographically and joined with a single `'|'`, so region ids must not themselves
 * contain `'|'`.
 */
export class BackboneRttTable {
  private readonly rtts: Map<string, number>

  /**
   * Builds a table from raw `"id_a|id_b" -> rtt_ms` config entries, canonicalizing each key so
   * lookups are order-independent. A malformed key (not exactly two `'|'`-separated ids) is
   * dropped with a warning; when two entries canonicalize to the same pair, the last wins.
   */
  constructor(entries: Iterable<[string, number]> = []) {
    this.rtts = new Map()
    for (const [key, rtt] of entries) {
      const canonical = canonicalizeConfigKey(key)
      if (canonical === undefined) {
        log.warn(`ignoring malformed backbone RTT key ${JSON.stringify(key)}`)
        continue
      }
      this.rtts.set(canonical, rtt)
    }
  }

  /**
   * Parses the table from the JSON object form used by `SB_REGION_BACKBONE_RTT_JSON`, e.g.
   * `{"us-east|eu-west": 90}`.
   */
  static fromJson(json: string): BackboneRttTable {
    const raw = JSON.parse(json) as Record<string, number>
    return new BackboneRttTable(Object.entries(raw))
  }

  /**
   * Loads the table from `SB_REGION_BACKBONE_RTT_JSON`, falling back to an empty table (every
   * cross-region pair then uses `DEFAULT_BACKBONE_RTT_MS`) when the variable is unset or
   * unparseable. An empty table is the correct dev-loopback state, so an unset variable is not an
   * error.
   */
  static fromEnv(): BackboneRttTable {
    const json = process.env[BACKBONE_ENV_VAR]
    if (!json) {
      return new BackboneRttTable()
    }
    try {
      return BackboneRttTable.fromJson(json)
    } catch (err) {
      log.error({ err }, `failed to parse ${BACKBONE_ENV_VAR}, using empty backbone table`)
      return new BackboneRttTable()
    }
  }

  /**
   * The backbone round-trip time (ms) between two regions: 0 for the same region, the configured
   * value for a known pair, or `DEFAULT_BACKBONE_RTT_MS` for an unconfigured pair.
   */
  rtt(a: string, b: string): number {
    if (a === b) {
      return 0
    }
    return this.rtts.get(pairKey(a, b)) ?? DEFAULT_BACKBONE_RTT_MS
  }
}

/** A single player's chosen home region and measured round-trip time to it, as recorded server-side. */
export interface LatencyEstimateInput {
  region?: string
  rttMs?: number
}

/**
 * Estimates a session's worst pairwise one-way latency (ms) across its players, for use as the
 * `latency_estimate_ms` hint on session create. Each pair's one-way estimate is
 * `rttA/2 + backbone(regionA, regionB)/2 + rttB/2`, where `rtt` is a player's measured round-trip
 * time to their chosen region and `backbone` is the static region-to-region round-trip time from
 * `SB_REGION_BACKBONE_RTT_JSON` (0 within a region, a conservative default for an unconfigured
 * pair). A lockstep game is bottlenecked by its slowest link, so the estimate is the maximum across
 * all pairs.
 *
 * A player missing either a region or a measured rtt carries no latency signal, so any pair
 * involving them is skipped and contributes nothing. Returns undefined when no pair is computable
 * (fewer than two players carry a signal), so the caller can omit the hint entirely rather than
 * sending a meaningless 0.
 */
export function worstPairwiseLatencyMs(
  players: readonly LatencyEstimateInput[],
): number | undefined {
  const backbone = BackboneRttTable.fromEnv()

  let worst: number | undefined
  for (let i = 0; i < players.length; i++) {
    const a = players[i]
    if (a.region === undefined || a.rttMs === undefined) {
      continue
    }
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]
      if (b.region === undefined || b.rttMs === undefined) {
        continue
      }
      const oneWay = a.rttMs / 2 + backbone.rtt(a.region, b.region) / 2 + b.rttMs / 2
      worst = worst === undefined ? oneWay : Math.max(worst, oneWay)
    }
  }

  return worst
}
