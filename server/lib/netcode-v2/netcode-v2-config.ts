/** A raw 32-byte Ed25519 seed as 64 hex characters — the `SB_RP2_CLIENT_KEY` format. */
export const ED25519_SEED_HEX_PATTERN = /^[0-9a-f]{64}$/i

export interface NetcodeV2Config {
  coordinatorUrl: string
  tenant: string
  /** TLS server name clients validate the relay certificate against. */
  relayServerName: string
}

/**
 * Loads netcode v2's coordinator config from the environment. Kept in its own module (rather than
 * alongside `NetcodeV2Service`) so a consumer that only needs the coordinator's base URL/tenant —
 * the game server region list fetch, the departures webhook's tenant pubkey fetch — doesn't have to
 * import the service class itself; `NetcodeV2Service` in turn depends on the game server region
 * list for its backbone RTT table, and that pair of imports would otherwise cycle.
 */
export function loadConfigFromEnv(): NetcodeV2Config | undefined {
  const coordinatorUrl = process.env.SB_RP2_COORDINATOR_URL
  if (!coordinatorUrl) {
    return undefined
  }

  const tenant = process.env.SB_RP2_TENANT
  if (!tenant) {
    throw new Error('SB_RP2_COORDINATOR_URL is set but SB_RP2_TENANT is missing')
  }

  // The client key is required whenever the coordinator is configured: every
  // coordinator-bound request is signed with it, so a missing/malformed key
  // must fail loudly here (config time) rather than at the first request. This
  // validates presence + format; `getClientSigningKey` builds the actual
  // KeyObject from the same env var.
  const clientKeySeedHex = process.env.SB_RP2_CLIENT_KEY
  if (!clientKeySeedHex) {
    throw new Error('SB_RP2_COORDINATOR_URL is set but SB_RP2_CLIENT_KEY is missing')
  }
  if (!ED25519_SEED_HEX_PATTERN.test(clientKeySeedHex)) {
    throw new Error('SB_RP2_CLIENT_KEY must be 64 hex characters (a 32-byte Ed25519 seed)')
  }

  return {
    coordinatorUrl,
    tenant,
    relayServerName: process.env.SB_RP2_RELAY_SERVER_NAME ?? 'localhost',
  }
}
