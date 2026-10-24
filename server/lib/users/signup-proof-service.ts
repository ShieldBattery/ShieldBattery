import httpErrors from 'http-errors'
import { createHmac, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
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
  completeSignupRequest,
  findSignupRequest,
  insertSignupRequest,
  SignupRequest,
} from './signup-request-models'
import { UserApiError } from './user-api-errors'

const REQUEST_TTL_MS = 5 * 60 * 1000
const DOMAIN = Buffer.from('sb-client-request-v1\0', 'ascii')
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function invalidProof(): never {
  throw new httpErrors.BadRequest('Invalid client request')
}

function decodeBase64(value: string, maxBytes: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4) invalidProof()
  const result = Buffer.from(value, 'base64')
  if (result.length > maxBytes || result.toString('base64') !== value) invalidProof()
  return result
}

function requestHash(fields: SignupFields, nonce: Buffer): Buffer {
  const secret = process.env.SB_JWT_SECRET
  if (!secret) throw new Error('SB_JWT_SECRET must be specified')
  // Keep the password binding opaque even if the short-lived request row is disclosed.
  const key = createHmac('sha256', secret).update('sb-signup-request-key-v1').digest()
  return createHmac('sha256', key)
    .update(nonce)
    .update(
      JSON.stringify([
        fields.username,
        fields.password,
        fields.email,
        fields.locale ?? null,
        fields.signupCode ?? null,
      ]),
    )
    .digest()
}

function identifiers(body: Buffer): ClientIdentifierString[] {
  if (body.length < 3 || (body[0] !== 1 && body[0] !== 2)) invalidProof()
  const format = body[0]
  const headerLength = format === 1 ? 3 : 4
  if (body.length < headerLength) invalidProof()
  const available = format === 1 ? body[1] : body.readUInt16LE(1)
  const count = body[headerLength - 1]
  if (count > (format === 1 ? 6 : 8) || body.length !== headerLength + count * 33) invalidProof()
  let previousKind = 0
  let mask = 0
  const result: ClientIdentifierString[] = []
  for (let offset = headerLength; offset < body.length; offset += 33) {
    const kind = body[offset]
    if (kind <= previousKind || !(kind <= 6 || (format === 2 && (kind === 8 || kind === 9)))) {
      invalidProof()
    }
    previousKind = kind
    mask |= 1 << (kind - 1)
    result.push([kind, body.subarray(offset + 1, offset + 33).toString('hex')])
  }
  if (available !== mask) invalidProof()
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
    const key = keys.find(k => k.keyId === proof.keyId)
    if (!key) invalidProof()
    const request = await findSignupRequest(attemptId)
    if (!request || request.expiresAt.getTime() <= this.clock.now()) invalidProof()
    if (!requestHash(fields, request.nonce).equals(request.requestHash)) invalidProof()
    const body = decodeBase64(proof.body, 268)
    const signature = decodeBase64(proof.signature, 64)
    if (signature.length !== 64) invalidProof()
    const keyId = Buffer.alloc(4)
    keyId.writeUInt32LE(proof.keyId)
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key.publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    if (
      !verify(
        null,
        Buffer.concat([DOMAIN, keyId, request.nonce, request.requestHash, body]),
        publicKey,
        signature,
      )
    ) {
      invalidProof()
    }
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
