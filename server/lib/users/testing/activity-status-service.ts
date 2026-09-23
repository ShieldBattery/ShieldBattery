import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { ActivityStatusService } from '../activity-status-service'

/** An `ActivityStatusService` that emits `change` only when a test emits it. */
export class FakeActivityStatusService
  extends EventEmitter
  implements
    Pick<
      ActivityStatusService,
      'getStatus' | 'setActivity' | 'clearActivity' | 'setInGame' | 'clearInGame'
    >
{
  getStatus = vi.fn().mockReturnValue(FriendActivityStatus.Online)
  setActivity = vi.fn()
  clearActivity = vi.fn()
  setInGame = vi.fn()
  clearInGame = vi.fn()
}

export function createFakeActivityStatusService(): ActivityStatusService {
  return new FakeActivityStatusService() as any as ActivityStatusService
}
