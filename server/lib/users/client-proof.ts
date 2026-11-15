import httpErrors from 'http-errors'
import { createHmac, createPublicKey, verify } from 'node:crypto'
import { ClientProof } from '../../../common/users/client-proof'
import { SessionReleaseKey } from '../netcode-v2/session-release-catalog'
import { ClientIdentifierString } from './client-ids'

const DOMAIN = Buffer.from('sb-client-request-v1\0', 'ascii')
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const IDENTIFIER_RECORD_BYTES = 33
const MAX_IDENTIFIERS = 8
const MAX_REPORT_BYTES = 128
/** A version 3 envelope with every identifier and the longest report. */
const MAX_BODY_BYTES = 4 + MAX_IDENTIFIERS * IDENTIFIER_RECORD_BYTES + 1 + MAX_REPORT_BYTES
/** The longest base64 encoding of a client proof body. */
export const MAX_ENCODED_BODY_LENGTH = Math.ceil(MAX_BODY_BYTES / 3) * 4

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

export interface IdentifierEnvelope {
  identifiers: ClientIdentifierString[]
  /** Whether the client reported its machine as supported. */
  machineSupported: boolean
}

/**
 * Parses a signed identifier envelope:
 *
 * - Version 1: `u8 version, u8 mask, u8 count`, then `count` (at most 6) identifier records.
 * - Version 2: `u8 version, u16le mask, u8 count`, then `count` (at most 8) identifier records.
 * - Version 3: version 2, then `u8 reportLength` (1 to 128) and that many report bytes. Report byte
 *   0 is the machine's support status (0 is supported); the remaining bytes are reserved.
 *
 * Each identifier record is a `u8 kind` and a 32 byte hash, in ascending kind order. Versions 1 and
 * 2 count as supported.
 */
export function parseIdentifierEnvelope(body: Buffer): IdentifierEnvelope {
  if (body.length < 3 || body[0] < 1 || body[0] > 3) invalidProof()
  const format = body[0]
  const headerLength = format === 1 ? 3 : 4
  if (body.length < headerLength) invalidProof()
  const available = format === 1 ? body[1] : body.readUInt16LE(1)
  const count = body[headerLength - 1]
  if (count > (format === 1 ? 6 : MAX_IDENTIFIERS)) invalidProof()
  const identifiersEnd = headerLength + count * IDENTIFIER_RECORD_BYTES

  let machineSupported = true
  if (format === 3) {
    if (body.length <= identifiersEnd) invalidProof()
    const reportLength = body[identifiersEnd]
    if (
      reportLength < 1 ||
      reportLength > MAX_REPORT_BYTES ||
      body.length !== identifiersEnd + 1 + reportLength
    ) {
      invalidProof()
    }
    machineSupported = body[identifiersEnd + 1] === 0
  } else if (body.length !== identifiersEnd) {
    invalidProof()
  }

  let previousKind = 0
  let mask = 0
  const identifiers: ClientIdentifierString[] = []
  for (let offset = headerLength; offset < identifiersEnd; offset += IDENTIFIER_RECORD_BYTES) {
    const kind = body[offset]
    if (kind <= previousKind || !(kind <= 6 || (format !== 1 && (kind === 8 || kind === 9)))) {
      invalidProof()
    }
    previousKind = kind
    mask |= 1 << (kind - 1)
    identifiers.push([
      kind,
      body.subarray(offset + 1, offset + IDENTIFIER_RECORD_BYTES).toString('hex'),
    ])
  }
  if (available !== mask) invalidProof()
  return { identifiers, machineSupported }
}
