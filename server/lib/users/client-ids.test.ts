import { Context } from 'koa'
import { expect, test } from 'vitest'
import { joiClientIdentifiers } from './client-ids'

const app = { get: () => 'shieldbattery://app' } as unknown as Context
const web = { get: () => '' } as unknown as Context

test('accepts browser fingerprints, native digests, and the development identifier', () => {
  expect(
    joiClientIdentifiers(app).validate([
      [0, 'browser'],
      [1, 'ab'.repeat(32)],
      [7, 'cd'.repeat(32)],
      [8, 'ef'.repeat(32)],
      [9, '12'.repeat(32)],
    ]).error,
  ).toBeUndefined()
  expect(joiClientIdentifiers(web).validate([]).error).toBeUndefined()
})

test.each(
  [
    [],
    [[1, 'short']],
    [[1, 'z'.repeat(64)]],
    [[1.5, 'ab'.repeat(32)]],
    [[10, 'ab'.repeat(32)]],
    [
      [1, 'ab'.repeat(32)],
      [1, 'cd'.repeat(32)],
    ],
    [[0, '']],
    [[0, 'browser', 'extra']],
  ].map(value => [value]),
)('rejects malformed or ambiguous identifier sets %#', value => {
  expect(joiClientIdentifiers(app).validate(value).error).toBeDefined()
})

test('accepts all ten distinct identifier kinds', () => {
  expect(
    joiClientIdentifiers(app).validate([
      [0, 'browser'],
      ...Array.from({ length: 9 }, (_, i) => [i + 1, 'ab'.repeat(32)]),
    ]).error,
  ).toBeUndefined()
})
