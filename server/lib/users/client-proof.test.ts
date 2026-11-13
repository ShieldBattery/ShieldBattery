import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { MAX_ENCODED_BODY_LENGTH, parseIdentifierEnvelope, verifyClientProof } from './client-proof'
import { TestClientKey } from './testing/client-proofs'

const invalid = expect.objectContaining({ status: 400, message: 'Invalid client request' })
const ALL_KINDS = [1, 2, 3, 4, 5, 6, 8, 9]

function envelope(format: 1 | 2 | 3, kinds: readonly number[], report?: Buffer): Buffer {
  const mask = kinds.reduce((value, kind) => value | (1 << (kind - 1)), 0)
  const header =
    format === 1
      ? Buffer.from([1, mask, kinds.length])
      : Buffer.from([format, mask & 0xff, mask >> 8, kinds.length])
  return Buffer.concat([
    header,
    ...kinds.map(kind => Buffer.concat([Buffer.from([kind]), Buffer.alloc(32, kind)])),
    ...(report ? [Buffer.from([report.length]), report] : []),
  ])
}

function identifiersFor(kinds: readonly number[]) {
  return kinds.map(kind => [kind, kind.toString(16).padStart(2, '0').repeat(32)])
}

describe('parseIdentifierEnvelope', () => {
  test.each([
    [1, [1, 2, 5, 6]],
    [1, [1, 2, 3, 4, 5, 6]],
    [2, [1, 2, 3, 9]],
    [2, ALL_KINDS],
  ] as const)('version %i parses identifiers and reports a supported machine', (format, kinds) => {
    expect(parseIdentifierEnvelope(envelope(format, kinds))).toEqual({
      identifiers: identifiersFor(kinds),
      machineSupported: true,
    })
  })

  test.each([1, 128])('version 3 accepts a report of %i bytes', length => {
    expect(parseIdentifierEnvelope(envelope(3, ALL_KINDS, Buffer.alloc(length)))).toEqual({
      identifiers: identifiersFor(ALL_KINDS),
      machineSupported: true,
    })
  })

  test('version 3 accepts an envelope without identifiers', () => {
    expect(parseIdentifierEnvelope(envelope(3, [], Buffer.alloc(1)))).toEqual({
      identifiers: [],
      machineSupported: true,
    })
  })

  test.each([1, 2, 0x80, 0xff])('version 3 status %i reports an unsupported machine', status => {
    expect(parseIdentifierEnvelope(envelope(3, [1, 2], Buffer.from([status])))).toEqual({
      identifiers: identifiersFor([1, 2]),
      machineSupported: false,
    })
  })

  test('version 3 ignores the reserved report bytes', () => {
    const reserved = randomBytes(127)
    expect(
      parseIdentifierEnvelope(envelope(3, [1], Buffer.concat([Buffer.from([0]), reserved])))
        .machineSupported,
    ).toBe(true)
    expect(
      parseIdentifierEnvelope(envelope(3, [1], Buffer.concat([Buffer.from([1]), reserved])))
        .machineSupported,
    ).toBe(false)
    expect(
      parseIdentifierEnvelope(envelope(3, [1], Buffer.from([0, 0xff, 0xff]))).machineSupported,
    ).toBe(true)
  })

  test('version 3 rejects an empty report', () => {
    const body = envelope(3, [1], Buffer.alloc(1))
    body[body.length - 2] = 0
    expect(() => parseIdentifierEnvelope(body.subarray(0, -1))).toThrow(invalid)
    expect(() => parseIdentifierEnvelope(body)).toThrow(invalid)
  })

  test('version 3 rejects a report longer than 128 bytes', () => {
    expect(() => parseIdentifierEnvelope(envelope(3, [1], Buffer.alloc(129)))).toThrow(invalid)
    const body = envelope(3, [1], Buffer.alloc(128))
    body[body.length - 129] = 129
    expect(() => parseIdentifierEnvelope(body)).toThrow(invalid)
  })

  test('version 3 rejects a missing report', () => {
    expect(() => parseIdentifierEnvelope(envelope(3, [1, 2]))).toThrow(invalid)
  })

  test.each([1, 128])('version 3 rejects truncated envelopes with a %i byte report', length => {
    const body = envelope(3, [1, 8, 9], Buffer.alloc(length))
    for (let end = 0; end < body.length; end += 1) {
      expect(() => parseIdentifierEnvelope(body.subarray(0, end))).toThrow(invalid)
    }
  })

  test.each([1, 128])('version 3 rejects trailing bytes after a %i byte report', length => {
    const body = envelope(3, [1, 8, 9], Buffer.alloc(length))
    expect(() => parseIdentifierEnvelope(Buffer.concat([body, Buffer.from([0])]))).toThrow(invalid)
  })

  test('version 3 validates identifiers like version 2', () => {
    const report = Buffer.alloc(1)
    for (const kinds of [[0], [7], [10], [2, 1], [1, 1]]) {
      expect(() => parseIdentifierEnvelope(envelope(3, kinds, report))).toThrow(invalid)
    }
    const wrongMask = envelope(3, [1, 8, 9], report)
    wrongMask[2] = 0
    expect(() => parseIdentifierEnvelope(wrongMask)).toThrow(invalid)
    const tooMany = envelope(3, ALL_KINDS, report)
    tooMany[3] = 9
    expect(() => parseIdentifierEnvelope(tooMany)).toThrow(invalid)
  })

  test('versions 1 and 2 reject a trailing report', () => {
    for (const format of [1, 2] as const) {
      expect(() => parseIdentifierEnvelope(envelope(format, [1], Buffer.alloc(1)))).toThrow(invalid)
    }
  })

  test.each([0, 4, 255])('rejects version %i', format => {
    const body = envelope(3, [1], Buffer.alloc(1))
    body[0] = format
    expect(() => parseIdentifierEnvelope(body)).toThrow(invalid)
  })
})

describe('verifyClientProof', () => {
  const key = new TestClientKey()
  const nonce = randomBytes(32)
  const context = randomBytes(32)

  function verify(body: Buffer) {
    return verifyClientProof(
      [key.releaseKey],
      key.sign(nonce.toString('base64'), context.toString('base64'), body),
      nonce,
      context,
    )
  }

  test('accepts the largest version 3 envelope', () => {
    const body = envelope(3, ALL_KINDS, Buffer.alloc(128))
    expect(body.length).toBe(397)
    expect(body.toString('base64')).toHaveLength(MAX_ENCODED_BODY_LENGTH)
    expect(verify(body)).toEqual(body)
  })

  test('rejects bodies larger than the largest version 3 envelope', () => {
    expect(() => verify(Buffer.alloc(398))).toThrow(invalid)
  })
})
