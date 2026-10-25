import { Counter } from '@prometheus-io/client'
import httpErrors from 'http-errors'
import { singleton } from 'tsyringe'
import { ClientProof } from '../../../common/users/client-proof'
import { UserErrorCode } from '../../../common/users/user-network'
import { CodedError } from '../errors/coded-error'
import { asHttpError, HttpErrorWithPayload } from '../errors/error-with-payload'
import { SessionReleaseCatalog } from '../netcode-v2/session-release-catalog'
import { ClientIdentifierString } from './client-ids'
import { parseIdentifierEnvelope, verifyClientProof } from './client-proof'

export type ClientAttestationMode = 'off' | 'observe' | 'required'
export type ClientAttestationFlow = 'login' | 'socket'
export type ClientAttestationOutcome =
  | 'valid'
  | 'invalid'
  | 'outdated'
  | 'missing'
  | 'expired'
  | 'abandoned'

export interface ClientAttestationResult {
  outcome: ClientAttestationOutcome
  identifiers?: ClientIdentifierString[]
}

const attestationsTotalMetric = new Counter({
  name: 'shieldbattery_client_attestations_total',
  labelNames: ['flow', 'mode', 'outcome'],
  help: 'Total number of app client proofs checked for logins and connections, by outcome',
})

// NOTE: Not UserApiErrors, to avoid an import cycle with the socket groups
function attestationError(code: UserErrorCode, message: string): never {
  throw asHttpError(403, new CodedError(code, message))
}

/** Throws the error for a failed `ClientAttestationResult`. */
export function clientAttestationFailed(outcome: ClientAttestationOutcome): never {
  if (outcome === 'outdated') {
    attestationError(UserErrorCode.ClientUpdateRequired, 'Client update required')
  }
  attestationError(UserErrorCode.ClientVerificationFailed, 'Client verification failed')
}

export function isClientAttestationFailure(err: unknown): boolean {
  if (!(err instanceof HttpErrorWithPayload)) return false
  const code = (err.payload as { code?: unknown } | undefined)?.code
  return (
    code === UserErrorCode.ClientVerificationFailed || code === UserErrorCode.ClientUpdateRequired
  )
}

@singleton()
export class ClientAttestation {
  constructor(private catalog: SessionReleaseCatalog) {}

  mode(): ClientAttestationMode {
    if (process.env.SB_REQUIRE_CLIENT_ATTESTATION === 'true') return 'required'
    return this.catalog.getClientKeys().length ? 'observe' : 'off'
  }

  assertAvailable() {
    if (this.mode() === 'required' && !this.catalog.getClientKeys().length) {
      throw new httpErrors.ServiceUnavailable('Client verification is temporarily unavailable')
    }
  }

  check(
    flow: ClientAttestationFlow,
    mode: ClientAttestationMode,
    nonce: Buffer,
    context: Buffer,
    proof: ClientProof | undefined,
  ): ClientAttestationResult {
    const result = this.evaluate(nonce, context, proof)
    this.record(flow, mode, result.outcome)
    return result
  }

  private evaluate(
    nonce: Buffer,
    context: Buffer,
    proof: ClientProof | undefined,
  ): ClientAttestationResult {
    if (!proof) {
      return { outcome: 'missing' }
    }
    const keys = this.catalog.getClientKeys()
    if (keys.length && !keys.some(k => k.keyId === proof.keyId)) {
      return { outcome: 'outdated' }
    }

    try {
      return {
        outcome: 'valid',
        identifiers: parseIdentifierEnvelope(verifyClientProof(keys, proof, nonce, context)),
      }
    } catch (err) {
      if (!httpErrors.isHttpError(err) || err.status !== 400) throw err
      return { outcome: 'invalid' }
    }
  }

  record(
    flow: ClientAttestationFlow,
    mode: ClientAttestationMode,
    outcome: ClientAttestationOutcome,
  ) {
    attestationsTotalMetric.labels(flow, mode, outcome).inc()
  }
}
