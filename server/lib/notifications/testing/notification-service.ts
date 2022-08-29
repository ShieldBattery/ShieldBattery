import NotificationService from '../notification-service'

export class FakeNotificationService
  implements Omit<NotificationService, 'publisher' | 'clientSocketsManager'>
{
  retrieveNotifications = jest.fn().mockResolvedValue([])
  addNotification = jest.fn().mockResolvedValue(undefined)
  clearBefore = jest.fn().mockResolvedValue(undefined)
  clearById = jest.fn().mockResolvedValue(undefined)
  clearFirstMatching = jest.fn().mockResolvedValue(undefined)
  markRead = jest.fn().mockResolvedValue(undefined)
}

export function createFakeNotificationService(): NotificationService {
  return new FakeNotificationService() as any as NotificationService
}
