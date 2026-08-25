import { describe, expect, it } from 'vitest'
import { NetcodeV2KeyRing } from './netcode-v2-key-ring'
import { NetcodeV2KeyPair } from './netcode-v2-keys'

function makeKeyPair(publicKey: string): NetcodeV2KeyPair {
  return { publicKey, privateKey: `private-${publicKey}` }
}

describe('NetcodeV2KeyRing', () => {
  it('looks up a pushed keypair by its public key', () => {
    const ring = new NetcodeV2KeyRing()
    const keyPair = makeKeyPair('pubkey-a')

    ring.push(keyPair)

    expect(ring.get('pubkey-a')).toEqual(keyPair)
  })

  it('returns undefined for a public key that was never pushed', () => {
    const ring = new NetcodeV2KeyRing()

    expect(ring.get('never-pushed')).toBeUndefined()
  })

  it('finds an earlier keypair even after a later one was pushed (out-of-order server echo)', () => {
    const ring = new NetcodeV2KeyRing()
    const first = makeKeyPair('pubkey-first')
    const second = makeKeyPair('pubkey-second')

    ring.push(first)
    ring.push(second)

    // The server may seat the player with the FIRST join's pubkey even though the SECOND generate
    // ran more recently -- the ring must still resolve it.
    expect(ring.get('pubkey-first')).toEqual(first)
    expect(ring.get('pubkey-second')).toEqual(second)
  })

  it('onlyKey returns the sole keypair when exactly one is outstanding', () => {
    const ring = new NetcodeV2KeyRing()
    const only = makeKeyPair('pubkey-a')
    ring.push(only)

    expect(ring.onlyKey()).toEqual(only)
  })

  it('onlyKey returns undefined when nothing has been pushed', () => {
    const ring = new NetcodeV2KeyRing()

    expect(ring.onlyKey()).toBeUndefined()
  })

  it('onlyKey refuses to guess among several outstanding keypairs', () => {
    const ring = new NetcodeV2KeyRing()
    ring.push(makeKeyPair('pubkey-a'))
    ring.push(makeKeyPair('pubkey-b'))

    // A server too old to echo the seated pubkey may have seated EITHER of these; picking the
    // most recent could pair its token with the other keypair's private key, failing the relay's
    // connection-binding challenge for the whole lobby. An explicit refusal (surfaced as an error
    // by the caller) beats that silent guess.
    expect(ring.onlyKey()).toBeUndefined()
  })

  it('evicts the oldest entry once capacity is exceeded', () => {
    const ring = new NetcodeV2KeyRing()
    // Capacity is 8: push 9 distinct keypairs and expect the first to be gone.
    for (let i = 0; i < 9; i++) {
      ring.push(makeKeyPair(`pubkey-${i}`))
    }

    expect(ring.get('pubkey-0')).toBeUndefined()
    for (let i = 1; i < 9; i++) {
      expect(ring.get(`pubkey-${i}`)).toEqual(makeKeyPair(`pubkey-${i}`))
    }
  })
})
