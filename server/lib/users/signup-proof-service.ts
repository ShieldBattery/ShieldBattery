import httpErrors from 'http-errors'
import { randomBytes, randomUUID } from 'node:crypto'
import { singleton } from 'tsyringe'
import {
  ClientProof,
  SignupChallengeResponse,
  SignupFields,
} from '../../../common/users/client-proof'
import { SbUserId } from '../../../common/users/sb-user-id'
import { UserErrorCode } from '../../../common/users/user-network'
import { DbClient } from '../db'
import isDev from '../env/is-dev'
import { SessionReleaseCatalog } from '../netcode-v2/session-release-catalog'
import { Clock } from '../time/clock'
import { ClientIdentifierString, MIN_IDENTIFIER_MATCHES } from './client-ids'
import {
  invalidProof,
  parseIdentifierEnvelope,
  requestContext,
  verifyClientProof,
} from './client-proof'
import {
  completeSignupRequest,
  findSignupRequest,
  insertSignupRequest,
  SignupRequest,
} from './signup-request-models'
import { UserApiError } from './user-api-errors'

const REQUEST_TTL_MS = 5 * 60 * 1000

function requestHash(fields: SignupFields, nonce: Buffer): Buffer {
  return requestContext('sb-signup-request-key-v1', nonce, [
    fields.username,
    fields.password,
    fields.email,
    fields.locale ?? null,
    fields.signupCode ?? null,
  ])
}

function identifiers(body: Buffer): ClientIdentifierString[] {
  const result = parseIdentifierEnvelope(body)
  if (result.length < MIN_IDENTIFIER_MATCHES) {
    throw new UserApiError(UserErrorCode.ClientSetupRequired, 'Client setup required')
  }
  return result
}

export interface VerifiedSignupRequest {
  completedUserId?: SbUserId
  clientIds: ClientIdentifierString[]
  lock: (client: DbClient) => Promise<SbUserId | undefined>
  complete: (client: DbClient, userId: SbUserId) => Promise<void>
}

@singleton()
export class SignupProofService {
  constructor(
    private catalog: SessionReleaseCatalog,
    private clock: Clock,
  ) {}

  private getClientKeys() {
    const keys = this.catalog.getClientKeys()
    if (
      !keys.length &&
      (!isDev || process.env.SB_RP2_RELEASE_ENVIRONMENT === 'production') &&
      process.env.SB_ALLOW_UNSIGNED_SIGNUP !== 'true'
    ) {
      throw new httpErrors.ServiceUnavailable('Signup is temporarily unavailable')
    }
    return keys
  }

  async challenge(fields: SignupFields): Promise<SignupChallengeResponse> {
    if (!this.getClientKeys().length) return { required: false }
    const nonce = randomBytes(32)
    const request: SignupRequest = {
      id: randomUUID(),
      nonce,
      requestHash: requestHash(fields, nonce),
      expiresAt: new Date(this.clock.now() + REQUEST_TTL_MS),
    }
    await insertSignupRequest(request)
    return {
      required: true,
      attemptId: request.id,
      nonce: nonce.toString('base64'),
      requestHash: request.requestHash.toString('base64'),
    }
  }

  async verify(
    fields: SignupFields,
    attemptId?: string,
    proof?: ClientProof,
  ): Promise<VerifiedSignupRequest | undefined> {
    const keys = this.getClientKeys()
    if (!keys.length) return undefined
    if (!attemptId || !proof || !Number.isInteger(proof.keyId)) invalidProof()
    if (!keys.some(k => k.keyId === proof.keyId)) invalidProof()
    const request = await findSignupRequest(attemptId)
    if (!request || request.expiresAt.getTime() <= this.clock.now()) invalidProof()
    if (!requestHash(fields, request.nonce).equals(request.requestHash)) invalidProof()
    const body = verifyClientProof(keys, proof, request.nonce, request.requestHash)
    const clientIds = identifiers(body)
    return {
      clientIds,
      completedUserId: request.userId,
      lock: async client => {
        const current = await findSignupRequest(attemptId, client)
        if (
          !current ||
          current.expiresAt.getTime() <= this.clock.now() ||
          !current.nonce.equals(request.nonce) ||
          !current.requestHash.equals(request.requestHash)
        ) {
          invalidProof()
        }
        return current.userId
      },
      complete: (client, userId) => completeSignupRequest(client, attemptId, userId),
    }
  }
}
