import { beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../common/testing/mocks'
import { fetchJson } from '../network/fetch'
import { FetchError } from '../network/fetch-errors'
import { createLoginSession, LoginCollection, LoginFields } from './login-request'

vi.mock('../network/fetch', () => ({ fetchJson: vi.fn() }))

const fields: LoginFields = { username: 'example', password: 'password', remember: true }
const challenge = {
  attemptId: '517c58a0-00cb-4c31-8302-590ec08a1e51',
  nonce: 'nonce',
  requestHash: 'hash',
}
const proof = { keyId: 3, body: 'body', signature: 'signature' }
const legacyIds = { clientIds: [[7, 'ab'.repeat(32)] as [number, string]] }
const session = { jwt: 'token' }

let collection: Required<LoginCollection>

function bodyOf(call: number) {
  return JSON.parse(asMockedFunction(fetchJson).mock.calls[call][1]!.body as string)
}

beforeEach(() => {
  asMockedFunction(fetchJson).mockReset()
  collection = {
    collectProof: vi.fn(async () => proof),
    collectLegacyIds: vi.fn(async () => legacyIds),
    developmentClient: false,
    onProofError: vi.fn(),
  }
})

test('signs the challenge and logs in with the proof alongside legacy identifiers', async () => {
  asMockedFunction(fetchJson).mockResolvedValueOnce({ challenge }).mockResolvedValueOnce(session)
  expect(await createLoginSession(fields, collection)).toBe(session)
  expect(bodyOf(0)).toEqual({ username: 'example', password: 'password' })
  expect(collection.collectProof).toHaveBeenCalledWith('nonce', 'hash')
  expect(bodyOf(1)).toEqual({ ...fields, ...legacyIds, attemptId: challenge.attemptId, proof })
})

test('logs in without a proof when it could not be collected, letting the server decide', async () => {
  const err = new Error('Client verification unavailable')
  collection.collectProof = vi.fn(async () => {
    throw err
  })
  asMockedFunction(fetchJson).mockResolvedValueOnce({ challenge }).mockResolvedValueOnce(session)
  expect(await createLoginSession(fields, collection)).toBe(session)
  expect(collection.onProofError).toHaveBeenCalledWith(err)
  expect(bodyOf(1)).toEqual({ ...fields, ...legacyIds })
})

test('uses legacy identifiers when the server sends no challenge', async () => {
  asMockedFunction(fetchJson).mockResolvedValueOnce({}).mockResolvedValueOnce(session)
  await createLoginSession(fields, collection)
  expect(collection.collectProof).not.toHaveBeenCalled()
  expect(bodyOf(1)).toEqual({ ...fields, ...legacyIds })
})

test('supports servers without the challenge endpoint', async () => {
  asMockedFunction(fetchJson)
    .mockRejectedValueOnce(new FetchError(new Response('', { status: 404 }), ''))
    .mockResolvedValueOnce(session)
  await createLoginSession(fields, collection)
  expect(bodyOf(1)).toEqual({ ...fields, ...legacyIds })
})

test('development builds identify themselves instead of requesting a challenge', async () => {
  asMockedFunction(fetchJson).mockResolvedValueOnce(session)
  await createLoginSession(fields, { ...collection, developmentClient: true })
  expect(fetchJson).toHaveBeenCalledOnce()
  expect(bodyOf(0)).toEqual({ ...fields, ...legacyIds, developmentClient: true })
})

test('browsers log in directly', async () => {
  asMockedFunction(fetchJson).mockResolvedValueOnce(session)
  await createLoginSession(fields, { ...collection, collectProof: undefined })
  expect(fetchJson).toHaveBeenCalledOnce()
  expect(bodyOf(0)).toEqual({ ...fields, ...legacyIds })
})
