import { beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../common/testing/mocks'
import { SignupFields } from '../../common/users/client-proof'
import { fetchJson } from '../network/fetch'
import { FetchError, FetchNetworkError } from '../network/fetch-errors'
import { createSignupSession } from './signup-request'

vi.mock('../network/fetch', () => ({ fetchJson: vi.fn() }))

const fields: SignupFields = {
  username: 'example',
  email: 'test@example.org',
  password: 'password',
}
const challenge = {
  required: true as const,
  attemptId: '517c58a0-00cb-4c31-8302-590ec08a1e51',
  nonce: 'nonce',
  requestHash: 'hash',
}
const proof = { keyId: 3, body: 'body', signature: 'signature' }
const session = { jwt: 'token' }
const collection = {
  collectProof: vi.fn(async () => proof),
  collectLegacyIds: vi.fn(async () => ({ clientIds: [[7, 'ab'.repeat(32)] as [number, string]] })),
}

function httpError(status: number) {
  return new FetchError(new Response('', { status }), '')
}

beforeEach(() => {
  vi.clearAllMocks()
  asMockedFunction(fetchJson).mockReset()
  collection.collectProof.mockResolvedValue(proof)
})

test('recovers one network failure using exactly the same proof, attempt, and body bytes', async () => {
  asMockedFunction(fetchJson)
    .mockResolvedValueOnce(challenge)
    .mockRejectedValueOnce(new FetchNetworkError(new TypeError('Failed to fetch')))
    .mockResolvedValueOnce(session)
  const controller = new AbortController()
  expect(await createSignupSession(fields, collection, controller.signal)).toBe(session)
  const calls = asMockedFunction(fetchJson).mock.calls
  expect(calls).toHaveLength(3)
  expect(calls[1]).toEqual(calls[2])
  expect(calls.every(([, options]) => options!.signal === controller.signal)).toBe(true)
  expect(JSON.parse(calls[1][1]!.body as string)).toEqual({
    ...fields,
    attemptId: challenge.attemptId,
    proof,
  })
  expect(collection.collectProof).toHaveBeenCalledExactlyOnceWith(
    challenge.nonce,
    challenge.requestHash,
  )
  expect(collection.collectLegacyIds).not.toHaveBeenCalled()
})

test('a second network failure stops retrying', async () => {
  const error = new FetchNetworkError(new TypeError('Failed to fetch'))
  asMockedFunction(fetchJson).mockResolvedValueOnce(challenge).mockRejectedValue(error)
  await expect(createSignupSession(fields, collection)).rejects.toBe(error)
  expect(fetchJson).toHaveBeenCalledTimes(3)
})

test.each([400, 401, 403, 404, 409, 429, 500, 503])(
  'never retries account creation HTTP %i',
  async status => {
    const error = httpError(status)
    asMockedFunction(fetchJson).mockResolvedValueOnce(challenge).mockRejectedValueOnce(error)
    await expect(createSignupSession(fields, collection)).rejects.toBe(error)
    expect(fetchJson).toHaveBeenCalledTimes(2)
  },
)

test('ordinary local signup needs no private native implementation', async () => {
  asMockedFunction(fetchJson)
    .mockResolvedValueOnce({ required: false })
    .mockResolvedValueOnce(session)
  expect(await createSignupSession(fields, collection)).toBe(session)
  expect(collection.collectProof).not.toHaveBeenCalled()
  expect(collection.collectLegacyIds).toHaveBeenCalledTimes(1)
  expect(JSON.parse(asMockedFunction(fetchJson).mock.calls[1][1]!.body as string)).toEqual({
    ...fields,
    clientIds: [[7, 'ab'.repeat(32)]],
  })
})

test('an older server without the challenge route uses legacy collection', async () => {
  asMockedFunction(fetchJson).mockRejectedValueOnce(httpError(404)).mockResolvedValueOnce(session)
  expect(await createSignupSession(fields, collection)).toBe(session)
  expect(collection.collectProof).not.toHaveBeenCalled()
  expect(collection.collectLegacyIds).toHaveBeenCalledTimes(1)
})

test('legacy account creation is never retried without an idempotency key', async () => {
  const error = new FetchNetworkError(new TypeError('Failed to fetch'))
  asMockedFunction(fetchJson)
    .mockResolvedValueOnce({ required: false })
    .mockRejectedValueOnce(error)
  await expect(createSignupSession(fields, collection)).rejects.toBe(error)
  expect(fetchJson).toHaveBeenCalledTimes(2)
})

test.each([401, 403, 429, 500, 503])(
  'challenge HTTP %i never falls back to unsigned signup',
  async status => {
    const error = httpError(status)
    asMockedFunction(fetchJson).mockRejectedValueOnce(error)
    await expect(createSignupSession(fields, collection)).rejects.toBe(error)
    expect(collection.collectLegacyIds).not.toHaveBeenCalled()
    expect(collection.collectProof).not.toHaveBeenCalled()
    expect(fetchJson).toHaveBeenCalledTimes(1)
  },
)

test('native collection failure cannot fall back to unsigned signup', async () => {
  const error = new Error('Client update required')
  asMockedFunction(fetchJson).mockResolvedValueOnce(challenge)
  collection.collectProof.mockRejectedValueOnce(error)
  await expect(createSignupSession(fields, collection)).rejects.toBe(error)
  expect(collection.collectLegacyIds).not.toHaveBeenCalled()
  expect(fetchJson).toHaveBeenCalledTimes(1)
})

test('an already aborted signup sends no requests', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(createSignupSession(fields, collection, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(fetchJson).not.toHaveBeenCalled()
})

test('aborting during native collection prevents account creation', async () => {
  const controller = new AbortController()
  asMockedFunction(fetchJson).mockResolvedValueOnce(challenge)
  collection.collectProof.mockImplementationOnce(async () => {
    controller.abort()
    return proof
  })
  await expect(createSignupSession(fields, collection, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(fetchJson).toHaveBeenCalledTimes(1)
})

test('aborting a failed POST prevents its network retry', async () => {
  const controller = new AbortController()
  asMockedFunction(fetchJson)
    .mockResolvedValueOnce(challenge)
    .mockImplementationOnce(async () => {
      controller.abort()
      throw new FetchNetworkError(new TypeError('Failed to fetch'))
    })
  await expect(createSignupSession(fields, collection, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(fetchJson).toHaveBeenCalledTimes(2)
})
