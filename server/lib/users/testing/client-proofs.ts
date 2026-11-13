import { generateKeyPairSync, sign } from 'node:crypto'
import { ClientProof } from '../../../../common/users/client-proof'
import { SessionReleaseKey } from '../../netcode-v2/session-release-catalog'

/** A version 1 identifier envelope containing one kind 1 identifier (`'07'.repeat(32)`). */
export const TEST_IDENTIFIER_BODY = Buffer.concat([Buffer.from([1, 1, 1, 1]), Buffer.alloc(32, 7)])

/**
 * A version 3 identifier envelope containing the same identifier as `TEST_IDENTIFIER_BODY`, with
 * a one byte report of `status` (0 is a supported machine).
 */
export function testReportBody(status: number): Buffer {
  return Buffer.concat([
    Buffer.from([3, 1, 0, 1, 1]),
    Buffer.alloc(32, 7),
    Buffer.from([1, status]),
  ])
}

export class TestClientKey {
  private readonly pair = generateKeyPairSync('ed25519')
  readonly releaseKey: SessionReleaseKey

  constructor(readonly keyId = 17) {
    this.releaseKey = {
      keyId,
      publicKey: this.pair.publicKey
        .export({ format: 'der', type: 'spki' })
        .subarray(-32)
        .toString('hex'),
    }
  }

  sign(nonce: string, requestHash: string, body: Buffer = TEST_IDENTIFIER_BODY): ClientProof {
    const keyId = Buffer.alloc(4)
    keyId.writeUInt32LE(this.keyId)
    const message = Buffer.concat([
      Buffer.from('sb-client-request-v1\0'),
      keyId,
      Buffer.from(nonce, 'base64'),
      Buffer.from(requestHash, 'base64'),
      body,
    ])
    return {
      keyId: this.keyId,
      body: body.toString('base64'),
      signature: sign(null, message, this.pair.privateKey).toString('base64'),
    }
  }
}
