import { apiUrl } from '../../common/urls'
import {
  ClientAttestationRequest,
  ClientChallenge,
  ClientProof,
} from '../../common/users/client-proof'
import logger from '../logging/logger'
import { fetchJson } from '../network/fetch'
import { collectProof } from './collect-proof'

// Shorter than the server's limit, so a stuck request can't outlive the connection's next attempt
const ANSWER_TIMEOUT_MS = 30_000

export async function answerChallenge({ attemptId, nonce, requestHash }: ClientChallenge) {
  let proof: ClientProof | undefined
  try {
    proof = await collectProof(nonce, requestHash)
  } catch (err) {
    logger.error(`Couldn't collect connection proof: ${(err as any)?.stack ?? String(err)}`)
  }

  await fetchJson<void>(apiUrl`sessions/client-attestation`, {
    method: 'post',
    body: JSON.stringify({ attemptId, proof } satisfies ClientAttestationRequest),
    signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
  })
}
