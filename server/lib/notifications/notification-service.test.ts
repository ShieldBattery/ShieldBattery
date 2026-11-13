import { describe, expect, test, vi } from 'vitest'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { NotificationType } from '../../../common/notifications'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { clearMatching, SearchNotificationData } from './notification-model'
import NotificationService, { getNotificationsPath } from './notification-service'

// Only the bulk clear is stubbed: every other model call is left real, and no test here reaches it.
vi.mock('./notification-model', async importOriginal => ({
  ...(await importOriginal<typeof import('./notification-model')>()),
  clearMatching: vi.fn(),
}))

const LOBBY_ID = makeSbLobbyId('aaaaaaaaaaaaaaaaaaaaaa')
const INVITE_CRITERIA = {
  type: NotificationType.LobbyInvite,
  lobbyId: LOBBY_ID,
} satisfies SearchNotificationData

function makeService() {
  const publisher = { publish: vi.fn() }
  const clientSocketsManager = { on: vi.fn() }
  const service = new NotificationService(publisher as any, clientSocketsManager as any)
  return { service, publisher }
}

describe('notifications/notification-service', () => {
  test('clearAllMatching tells each affected user which notification went away', async () => {
    vi.mocked(clearMatching).mockResolvedValue([
      { id: 'notification-1', userId: makeSbUserId(2) },
      { id: 'notification-2', userId: makeSbUserId(3) },
    ])
    const { service, publisher } = makeService()

    await service.clearAllMatching(INVITE_CRITERIA)

    expect(clearMatching).toHaveBeenCalledWith(INVITE_CRITERIA)
    expect(publisher.publish).toHaveBeenCalledTimes(2)
    expect(publisher.publish).toHaveBeenCalledWith(getNotificationsPath(makeSbUserId(2)), {
      type: 'clearById',
      notificationId: 'notification-1',
    })
    expect(publisher.publish).toHaveBeenCalledWith(getNotificationsPath(makeSbUserId(3)), {
      type: 'clearById',
      notificationId: 'notification-2',
    })
  })

  test('clearAllMatching publishes nothing when nothing matched', async () => {
    vi.mocked(clearMatching).mockResolvedValue([])
    const { service, publisher } = makeService()

    await service.clearAllMatching(INVITE_CRITERIA)

    expect(publisher.publish).not.toHaveBeenCalled()
  })
})
