import { vi } from 'vitest'
import NotificationService from '../notification-service'

export class FakeNotificationService
  implements Omit<NotificationService, 'publisher' | 'clientSocketsManager'>
{
  retrieveNotifications = vi.fn().mockResolvedValue([])
  addNotification = vi.fn().mockResolvedValue(undefined)
  clearBefore = vi.fn().mockResolvedValue(undefined)
  clearById = vi.fn().mockResolvedValue(undefined)
  clearFirstMatching = vi.fn().mockResolvedValue(undefined)
  markRead = vi.fn().mockResolvedValue(undefined)
}

export function createFakeNotificationService(): NotificationService {
  return new FakeNotificationService() as any as NotificationService
}
