import { MockInstance, vi } from 'vitest'

/**
 * Casts any given function to vitest's mocked function type, preserving its original signature.
 */
export function asMockedFunction<T extends (...args: any[]) => any>(fn: T): MockInstance<T> {
  if (!vi.isMockFunction(fn)) {
    throw new Error('Function must be a mock function to use asMockedFunction')
  }
  return fn
}
