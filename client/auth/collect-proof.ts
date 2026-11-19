import { TypedIpcRenderer } from '../../common/ipc'
import { ClientProof } from '../../common/users/client-proof'

const typedIpc = new TypedIpcRenderer()

export class CollectProofError extends Error {}

export async function collectProof(nonce: string, requestHash: string): Promise<ClientProof> {
  const proof = await typedIpc.invoke('securityCollectRequest', nonce, requestHash)
  if (!proof) throw new CollectProofError('Client verification failed')
  return proof
}
