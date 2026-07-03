import { generateKeyPairSync } from 'node:crypto'

/**
 * The fixed layout of a PKCS#8 v2 (RFC 5958 `OneAsymmetricKey`) Ed25519 document, which embeds the
 * public key alongside the private seed. The game process's crypto library (ring) only accepts
 * this form — Node's own `pkcs8` export produces the v1 form (no public key) which it rejects —
 * so we assemble the v2 document ourselves. Ed25519 keys are fixed-size, making the ASN.1 layout
 * a constant 85-byte template:
 *
 *     SEQUENCE (83 bytes)
 *       INTEGER 1                                     -- version (v2)
 *       SEQUENCE { OID 1.3.101.112 }                  -- Ed25519 algorithm
 *       OCTET STRING { OCTET STRING (32-byte seed) }  -- privateKey
 *       [1] BIT STRING (33 bytes: pad + 32-byte pub)  -- publicKey
 */
const PKCS8_V2_PREFIX = Buffer.from('3053020101300506032b657004220420', 'hex')
const PKCS8_V2_PUBKEY_HEADER = Buffer.from('a123032100', 'hex')

/** Length of a Node `pkcs8` DER export for Ed25519 (v1 form); the last 32 bytes are the seed. */
const PKCS8_V1_LEN = 48
/** Length of a Node `spki` DER export for Ed25519; the last 32 bytes are the raw public key. */
const SPKI_LEN = 44

/**
 * Builds a PKCS#8 v2 Ed25519 document from a raw 32-byte seed and its raw 32-byte public key.
 * Exported for tests (verifiable against the RFC 8032 test vectors).
 */
export function buildPkcs8V2(seed: Buffer, publicKey: Buffer): Buffer {
  if (seed.length !== 32 || publicKey.length !== 32) {
    throw new Error('Ed25519 seed and public key must be exactly 32 bytes')
  }
  return Buffer.concat([PKCS8_V2_PREFIX, seed, PKCS8_V2_PUBKEY_HEADER, publicKey])
}

export interface NetcodeV2KeyPair {
  /** base64 (standard, padded) of the raw 32-byte Ed25519 public key. */
  publicKey: string
  /** base64 (standard, padded) of the PKCS#8 v2 Ed25519 private key document. */
  privateKey: string
}

/**
 * Generates the per-session Ed25519 keypair for a netcode v2 game. The public key is submitted to
 * the server (which embeds it in the coordinator-signed session token); the private key is handed
 * only to the game process, which uses it to prove key possession to the relay.
 */
export function generateNetcodeV2KeyPair(): NetcodeV2KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const pkcs8V1 = privateKey.export({ type: 'pkcs8', format: 'der' })
  if (spki.length !== SPKI_LEN || pkcs8V1.length !== PKCS8_V1_LEN) {
    throw new Error(
      `unexpected Ed25519 export lengths: spki=${spki.length}, pkcs8=${pkcs8V1.length}`,
    )
  }

  const rawPublic = Buffer.from(spki.subarray(SPKI_LEN - 32))
  const seed = Buffer.from(pkcs8V1.subarray(PKCS8_V1_LEN - 32))
  return {
    publicKey: rawPublic.toString('base64'),
    privateKey: buildPkcs8V2(seed, rawPublic).toString('base64'),
  }
}
