import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildPkcs8V2, generateNetcodeV2KeyPair } from './netcode-v2-keys'

// RFC 8032 §7.1 test vector 1
const RFC8032_SEED = Buffer.from(
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
  'hex',
)
const RFC8032_PUBLIC = Buffer.from(
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  'hex',
)

describe('buildPkcs8V2', () => {
  it('produces the exact 85-byte v2 document for the RFC 8032 test vector', () => {
    const doc = buildPkcs8V2(RFC8032_SEED, RFC8032_PUBLIC)
    // This layout must stay byte-for-byte in sync with the game side: ring only accepts its own
    // v2 template. The same constant is asserted in game/src/netcode_v2/credentials.rs tests.
    expect(doc.toString('hex')).toBe(
      '3053020101300506032b657004220420' +
        RFC8032_SEED.toString('hex') +
        'a123032100' +
        RFC8032_PUBLIC.toString('hex'),
    )
    expect(doc.length).toBe(85)
  })

  it('rejects wrong-size inputs', () => {
    expect(() => buildPkcs8V2(Buffer.alloc(31), RFC8032_PUBLIC)).toThrow()
    expect(() => buildPkcs8V2(RFC8032_SEED, Buffer.alloc(33))).toThrow()
  })
})

describe('generateNetcodeV2KeyPair', () => {
  it('generates a keypair whose v2 document round-trips through node crypto', () => {
    const { publicKey, privateKey } = generateNetcodeV2KeyPair()

    const pubBytes = Buffer.from(publicKey, 'base64')
    expect(pubBytes.length).toBe(32)

    // The v2 document must be parseable and the embedded keys must actually correspond: sign with
    // the reimported private key, verify with the raw public key we returned.
    const keyObject = createPrivateKey({
      key: Buffer.from(privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    })
    const derivedPub = createPublicKey(keyObject).export({ type: 'spki', format: 'der' })
    expect(Buffer.from(derivedPub.subarray(derivedPub.length - 32))).toEqual(pubBytes)

    const message = Buffer.from('netcode v2 challenge')
    const signature = sign(null, message, keyObject)
    expect(verify(null, message, createPublicKey(keyObject), signature)).toBe(true)
  })

  it('generates a distinct keypair each call', () => {
    expect(generateNetcodeV2KeyPair().publicKey).not.toBe(generateNetcodeV2KeyPair().publicKey)
  })
})
