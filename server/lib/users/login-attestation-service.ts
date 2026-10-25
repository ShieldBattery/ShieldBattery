import { randomBytes, randomUUID } from 'node:crypto'
import { singleton } from 'tsyringe'
import {
  ClientProof,
  LoginChallengeRequest,
  LoginChallengeResponse,
} from '../../../common/users/client-proof'
import { Redis } from '../redis/redis'
import {
  ClientAttestation,
  clientAttestationFailed,
  ClientAttestationResult,
} from './client-attestation'
import { ClientIdentifierString } from './client-ids'
import { requestContext } from './client-proof'

const CHALLENGE_TTL_SECONDS = 5 * 60

function challengeKey(attemptId: string) {
  return `login-attestations:${attemptId}`
}

function loginContext({ username, password }: LoginChallengeRequest, nonce: Buffer): Buffer {
  return requestContext('sb-login-request-key-v1', nonce, [username, password])
}

interface StoredChallenge {
  nonce: string
  requestHash: string
}

@singleton()
export class LoginAttestationService {
  constructor(
    private attestation: ClientAttestation,
    private redis: Redis,
  ) {}

  async challenge(fields: LoginChallengeRequest): Promise<LoginChallengeResponse> {
    const mode = this.attestation.mode()
    if (mode === 'off') return {}
    this.attestation.assertAvailable()

    const attemptId = randomUUID()
    const nonce = randomBytes(32)
    const stored: StoredChallenge = {
      nonce: nonce.toString('base64'),
      requestHash: loginContext(fields, nonce).toString('base64'),
    }
    await this.redis.client.setEx(
      challengeKey(attemptId),
      CHALLENGE_TTL_SECONDS,
      JSON.stringify(stored),
    )

    return { challenge: { attemptId, ...stored } }
  }

  async verify(
    fields: LoginChallengeRequest,
    attemptId: string | undefined,
    proof: ClientProof | undefined,
  ): Promise<ClientIdentifierString[] | undefined> {
    const mode = this.attestation.mode()
    if (mode === 'off') return undefined
    this.attestation.assertAvailable()

    let result: ClientAttestationResult
    const stored = attemptId ? await this.redis.client.getDel(challengeKey(attemptId)) : null
    if (!stored) {
      result = { outcome: attemptId && proof ? 'expired' : 'missing' }
      this.attestation.record('login', mode, result.outcome)
    } else {
      const challenge: StoredChallenge = JSON.parse(stored)
      const nonce = Buffer.from(challenge.nonce, 'base64')
      const requestHash = Buffer.from(challenge.requestHash, 'base64')
      if (!loginContext(fields, nonce).equals(requestHash)) {
        result = { outcome: 'invalid' }
        this.attestation.record('login', mode, result.outcome)
      } else {
        result = this.attestation.check('login', mode, nonce, requestHash, proof)
      }
    }

    if (!result.identifiers && mode === 'required') {
      clientAttestationFailed(result.outcome)
    }
    return result.identifiers
  }
}
