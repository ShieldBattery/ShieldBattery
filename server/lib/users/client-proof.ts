import httpErrors from 'http-errors'
import { createHmac, createPublicKey, verify } from 'node:crypto'
import { ClientProof } from '../../../common/users/client-proof'
import { SessionReleaseKey } from '../netcode-v2/session-release-catalog'
import { ClientIdentifierString } from './client-ids'

const DOMAIN = Buffer.from('sb-client-request-v1\0', 'ascii')
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const MAX_BODY_BYTES = 268

export function invalidProof(): never {
  throw new httpErrors.BadRequest('Invalid client request')
}

function decodeBase64(value: string, maxBytes: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4) invalidProof()
  const result = Buffer.from(value, 'base64')
  if (result.length > maxBytes || result.toString('base64') !== value) invalidProof()
  return result
}

export function requestContext(label: string, nonce: Buffer, data: unknown): Buffer {
  const secret = process.env.SB_JWT_SECRET
  if (!secret) throw new Error('SB_JWT_SECRET must be specified')
  const key = createHmac('sha256', secret).update(label).digest()
  return createHmac('sha256', key).update(nonce).update(JSON.stringify(data)).digest()
}

export function verifyClientProof(
  keys: readonly SessionReleaseKey[],
  proof: ClientProof,
  nonce: Buffer,
  context: Buffer,
): Buffer {
  if (!Number.isInteger(proof.keyId)) invalidProof()
  const key = keys.find(k => k.keyId === proof.keyId)
  if (!key) invalidProof()
  const body = decodeBase64(proof.body, MAX_BODY_BYTES)
  const signature = decodeBase64(proof.signature, 64)
  if (signature.length !== 64) invalidProof()
  const keyId = Buffer.alloc(4)
  keyId.writeUInt32LE(proof.keyId)
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key.publicKey, 'hex')]),
    format: 'der',
    type: 'spki',
  })
  if (!verify(null, Buffer.concat([DOMAIN, keyId, nonce, context, body]), publicKey, signature)) {
    invalidProof()
  }
  return body
}

export function parseIdentifierEnvelope(body: Buffer): ClientIdentifierString[] {
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
  return result
}
