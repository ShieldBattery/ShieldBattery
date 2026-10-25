import { apiUrl } from '../../common/urls'
import { ClientProof, LoginChallengeResponse } from '../../common/users/client-proof'
import { ClientSessionInfo } from '../../common/users/session'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'

export interface LoginFields {
  username: string
  password: string
  remember: boolean
  locale?: string
}

export interface LoginCollection {
  collectProof?: (nonce: string, requestHash: string) => Promise<ClientProof>
  collectLegacyIds: () => Promise<{ clientIds: [number, string][] }>
  developmentClient: boolean
  onProofError?: (err: unknown) => void
}

export async function createLoginSession(
  fields: LoginFields,
  collection: LoginCollection,
  signal?: AbortSignal,
): Promise<ClientSessionInfo> {
  signal?.throwIfAborted()
  let attestation: { attemptId: string; proof: ClientProof } | undefined
  if (collection.collectProof && !collection.developmentClient) {
    let challenge: LoginChallengeResponse
    try {
      challenge = await fetchJson<LoginChallengeResponse>(apiUrl`sessions/challenge`, {
        method: 'post',
        body: JSON.stringify({ username: fields.username, password: fields.password }),
        signal,
      })
    } catch (err) {
      if (!isFetchError(err) || err.status !== 404) throw err
      challenge = {}
    }
    signal?.throwIfAborted()

    if (challenge.challenge) {
      const { attemptId, nonce, requestHash } = challenge.challenge
      try {
        attestation = { attemptId, proof: await collection.collectProof(nonce, requestHash) }
      } catch (err) {
        collection.onProofError?.(err)
      }
    }
  }

  const legacyIds = await collection.collectLegacyIds()
  signal?.throwIfAborted()
  return await fetchJson<ClientSessionInfo>(apiUrl`sessions`, {
    method: 'post',
    body: JSON.stringify({
      ...fields,
      ...legacyIds,
      ...attestation,
      ...(collection.developmentClient ? { developmentClient: true } : {}),
    }),
    signal,
  })
}
