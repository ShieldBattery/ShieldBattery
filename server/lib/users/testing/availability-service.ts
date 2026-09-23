import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import { AvailabilityService } from '../availability-service'

/**
 * An `AvailabilityService` whose `get` reports every user as still loading, and which emits
 * `change` only when a test emits it.
 */
export class FakeAvailabilityService extends EventEmitter {
  get = vi.fn().mockReturnValue(undefined)
}

export function createFakeAvailabilityService(): AvailabilityService {
  return new FakeAvailabilityService() as any as AvailabilityService
}
