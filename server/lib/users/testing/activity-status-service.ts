import { vi } from 'vitest'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { ActivityStatusService } from '../activity-status-service'

export class FakeActivityStatusService implements Pick<
  ActivityStatusService,
  keyof ActivityStatusService
> {
  getStatus = vi.fn().mockReturnValue(FriendActivityStatus.Online)
  setActivity = vi.fn()
  clearActivity = vi.fn()
  setInGame = vi.fn()
  clearInGame = vi.fn()
}

export function createFakeActivityStatusService(): ActivityStatusService {
  return new FakeActivityStatusService() as any as ActivityStatusService
}
