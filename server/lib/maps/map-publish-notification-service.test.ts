import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbMapId } from '../../../common/maps'
import { NotificationType } from '../../../common/notifications'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import NotificationService from '../notifications/notification-service'
import { RedisSubscriber } from '../redis/redis'
import { MapPublishNotificationService } from './map-publish-notification-service'

class FakeRedisSubscriber {
  private handlers = new Map<string, Array<(message: any) => void>>()

  subscribe = vi.fn(async (channel: string, handler: (message: any) => void) => {
    const existing = this.handlers.get(channel) ?? []
    existing.push(handler)
    this.handlers.set(channel, existing)
  })

  emit(channel: string, message: any) {
    for (const handler of this.handlers.get(channel) ?? []) {
      handler(message)
    }
  }
}

const PUBLISHER = makeSbUserId(7)
const FILE_ID = makeSbMapId('file-id')
const FAMILY_ID = '11111111-2222-3333-4444-555555555555'

describe('server/lib/maps/map-publish-notification-service', () => {
  let redis: FakeRedisSubscriber
  let addNotification: ReturnType<typeof vi.fn>
  let service: MapPublishNotificationService

  beforeEach(() => {
    redis = new FakeRedisSubscriber()
    addNotification = vi.fn(async () => {})
    service = new MapPublishNotificationService(
      redis as unknown as RedisSubscriber,
      { addNotification } as unknown as NotificationService,
    )
  })

  test('subscribes to the mapPublish channel', () => {
    expect(service).toBeDefined()
    expect(redis.subscribe).toHaveBeenCalledWith('mapPublish', expect.any(Function))
  })

  test('notifies the publisher when a file is delisted', () => {
    redis.emit('mapPublish', {
      type: 'fileDelisted',
      data: {
        fileId: FILE_ID,
        familyId: FAMILY_ID,
        publisherId: PUBLISHER,
        name: 'Cool Map',
        note: 'Contains an offensive image',
      },
    })

    expect(addNotification).toHaveBeenCalledWith({
      userId: PUBLISHER,
      data: {
        type: NotificationType.MapFileDelisted,
        mapId: FILE_ID,
        familyId: FAMILY_ID,
        mapName: 'Cool Map',
        note: 'Contains an offensive image',
      },
    })
  })

  test('notifies the publisher when a held file is listed', () => {
    redis.emit('mapPublish', {
      type: 'heldPublishListed',
      data: { fileId: FILE_ID, familyId: FAMILY_ID, publisherId: PUBLISHER, name: 'Cool Map' },
    })

    expect(addNotification).toHaveBeenCalledWith({
      userId: PUBLISHER,
      data: {
        type: NotificationType.MapPublishApproved,
        mapId: FILE_ID,
        familyId: FAMILY_ID,
        mapName: 'Cool Map',
      },
    })
  })

  test('ignores unknown message types', () => {
    redis.emit('mapPublish', { type: 'somethingElse', data: {} })

    expect(addNotification).not.toHaveBeenCalled()
  })
})
