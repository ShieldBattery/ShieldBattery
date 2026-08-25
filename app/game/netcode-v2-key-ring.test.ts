import { describe, expect, it } from 'vitest'
import { NetcodeV2KeyRing } from './netcode-v2-key-ring'
import { NetcodeV2KeyPair } from './netcode-v2-keys'

function makeKeyPair(publicKey: string): NetcodeV2KeyPair {
  return { publicKey, privateKey: `private-${publicKey}` }
}

describe('NetcodeV2KeyRing', () => {
  it('adopts a pushed keypair by its echoed public key', () => {
    const ring = new NetcodeV2KeyRing()
    const keyPair = makeKeyPair('pubkey-a')

    ring.push(keyPair)

    expect(ring.adoptFor('pubkey-a')).toEqual({ keys: keyPair })
  })

  it('fails as unknownPubkey for an echoed key that was never pushed', () => {
    const ring = new NetcodeV2KeyRing()
    ring.push(makeKeyPair('pubkey-a'))

    expect(ring.adoptFor('never-pushed')).toEqual({ failure: 'unknownPubkey' })
  })

  it('fails as noKeysGenerated when the ring is empty', () => {
    const ring = new NetcodeV2KeyRing()

    expect(ring.adoptFor('pubkey-a')).toEqual({ failure: 'noKeysGenerated' })
    expect(ring.adoptFor(undefined)).toEqual({ failure: 'noKeysGenerated' })
  })

  it('adopts an earlier keypair even after a later one was pushed (out-of-order server echo)', () => {
    const ring = new NetcodeV2KeyRing()
    const first = makeKeyPair('pubkey-first')
    const second = makeKeyPair('pubkey-second')

    ring.push(first)
    ring.push(second)

    // The server may seat the player with the FIRST join's pubkey even though the SECOND generate
    // ran more recently -- the ring must still resolve it.
    expect(ring.adoptFor('pubkey-first')).toEqual({ keys: first })
  })

  it('without an echo, adopts the sole outstanding keypair', () => {
    const ring = new NetcodeV2KeyRing()
    const only = makeKeyPair('pubkey-a')
    ring.push(only)

    expect(ring.adoptFor(undefined)).toEqual({ keys: only })
  })

  it('without an echo, refuses to guess among several outstanding keypairs', () => {
    const ring = new NetcodeV2KeyRing()
    ring.push(makeKeyPair('pubkey-a'))
    ring.push(makeKeyPair('pubkey-b'))

    // A server too old to echo the seated pubkey may have seated EITHER of these; picking the
    // most recent could pair its token with the other keypair's private key, failing the relay's
    // connection-binding challenge for the whole lobby. An explicit refusal (surfaced as an error
    // by the caller) beats that silent guess.
    expect(ring.adoptFor(undefined)).toEqual({ failure: 'ambiguousWithoutEcho' })
  })

  it('a lingering adopted keypair never makes the echo-less fallback ambiguous', () => {
    const ring = new NetcodeV2KeyRing()
    const gameA = makeKeyPair('pubkey-game-a')
    ring.push(gameA)
    expect(ring.adoptFor(undefined)).toEqual({ keys: gameA })

    // Game A's key stays in the ring as a requeue reservation, but a newer join replaces the
    // server-side ticket it could be requeued from -- so the echo-less selection must prefer the
    // fresh key, not refuse as ambiguous (which would break the old-server fallback after the
    // first game).
    const gameB = makeKeyPair('pubkey-game-b')
    ring.push(gameB)
    expect(ring.adoptFor(undefined)).toEqual({ keys: gameB })
  })

  it('an adopted keypair resolves again when the server echoes it for a requeued match', () => {
    const ring = new NetcodeV2KeyRing()
    const keys = makeKeyPair('pubkey-a')
    ring.push(keys)
    expect(ring.adoptFor('pubkey-a')).toEqual({ keys })

    // A failed matchmaking load requeues the player server-side with the SAME pubkey (the queue
    // entry survives; only its queue time resets), and the next match arrives under a new game
    // id -- which never carries the previous game's keypair forward, so this second lookup is
    // how the requeued match gets its private key.
    expect(ring.adoptFor('pubkey-a')).toEqual({ keys })
  })

  it('an echo-less requeue reuses the sole adopted reservation', () => {
    const ring = new NetcodeV2KeyRing()
    const keys = makeKeyPair('pubkey-a')
    ring.push(keys)
    expect(ring.adoptFor(undefined)).toEqual({ keys })

    // Same requeue flow against a server that predates the echo: with nothing newer outstanding,
    // the adopted reservation is the only keypair the server can hold for this player.
    expect(ring.adoptFor(undefined)).toEqual({ keys })
  })

  it('adopting a newer keypair retires an older adopted reservation', () => {
    const ring = new NetcodeV2KeyRing()
    const gameA = makeKeyPair('pubkey-game-a')
    const gameB = makeKeyPair('pubkey-game-b')
    ring.push(gameA)
    expect(ring.adoptFor('pubkey-game-a')).toEqual({ keys: gameA })
    ring.push(gameB)
    expect(ring.adoptFor('pubkey-game-b')).toEqual({ keys: gameB })

    // Game B's adoption proves game A's ticket is gone (a newer join replaced it), so A's
    // reservation is retired along with the other superseded predecessors.
    expect(ring.adoptFor('pubkey-game-a')).toEqual({ failure: 'unknownPubkey' })
  })

  it('adoption by echo retires the superseded predecessors but keeps newer keypairs', () => {
    const ring = new NetcodeV2KeyRing()
    const older = makeKeyPair('pubkey-older')
    const seated = makeKeyPair('pubkey-seated')
    const newer = makeKeyPair('pubkey-newer')
    ring.push(older)
    ring.push(seated)
    ring.push(newer)

    expect(ring.adoptFor('pubkey-seated')).toEqual({ keys: seated })

    // The seated key and everything generated before it belonged to this launch's superseded
    // join attempts; a key generated after it may belong to a newer join already in flight and
    // must survive as the sole (echo-less-adoptable) entry.
    expect(ring.adoptFor(undefined)).toEqual({ keys: newer })
  })

  it('evicts the oldest entry once capacity is exceeded', () => {
    const ring = new NetcodeV2KeyRing()
    // Capacity is 8: push 9 distinct keypairs and expect the first to be gone.
    for (let i = 0; i < 9; i++) {
      ring.push(makeKeyPair(`pubkey-${i}`))
    }

    expect(ring.adoptFor('pubkey-0')).toEqual({ failure: 'unknownPubkey' })
    expect(ring.adoptFor('pubkey-8')).toEqual({ keys: makeKeyPair('pubkey-8') })
  })
})
