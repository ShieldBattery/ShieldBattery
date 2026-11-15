import { beforeEach, expect, test } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { MachineSupportRegistry } from './machine-support-registry'

const USER_A = makeSbUserId(1)
const USER_B = makeSbUserId(2)

let registry: MachineSupportRegistry

beforeEach(() => {
  registry = new MachineSupportRegistry()
})

test('clients are supported until they report otherwise', () => {
  expect(registry.isSupported(USER_A, 'client')).toBe(true)
  registry.record(USER_A, 'client', 'socket-1', true)
  expect(registry.isSupported(USER_A, 'client')).toBe(true)
  registry.record(USER_A, 'client', 'socket-1', false)
  expect(registry.isSupported(USER_A, 'client')).toBe(false)
})

test('statuses are kept per client', () => {
  registry.record(USER_A, 'client', 'socket-1', false)
  expect(registry.isSupported(USER_A, 'other')).toBe(true)
  expect(registry.isSupported(USER_B, 'client')).toBe(true)
})

test('a client is unsupported while any of its connections reported so', () => {
  registry.record(USER_A, 'client', 'socket-1', false)
  registry.record(USER_A, 'client', 'socket-2', false)
  registry.record(USER_A, 'client', 'socket-3', true)
  registry.forget(USER_A, 'client', 'socket-1')
  expect(registry.isSupported(USER_A, 'client')).toBe(false)
  registry.forget(USER_A, 'client', 'socket-2')
  expect(registry.isSupported(USER_A, 'client')).toBe(true)
})

test('forgetting unknown connections is harmless', () => {
  registry.forget(USER_A, 'client', 'socket-1')
  registry.record(USER_A, 'client', 'socket-1', false)
  registry.forget(USER_A, 'client', 'socket-2')
  registry.forget(USER_B, 'client', 'socket-1')
  expect(registry.isSupported(USER_A, 'client')).toBe(false)
})
