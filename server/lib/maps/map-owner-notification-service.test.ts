import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbMapId } from '../../../common/maps'
import { NotificationType } from '../../../common/notifications'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import NotificationService from '../notifications/notification-service'
import { RedisSubscriber } from '../redis/redis'
import { MapOwnerNotificationService } from './map-owner-notification-service'

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

const CLAIMANT = makeSbUserId(7)
const OWNER = makeSbUserId(8)
const ACTOR = makeSbUserId(9)
const FILE_ID = makeSbMapId('file-id')
const FAMILY_ID = '11111111-2222-3333-4444-555555555555'

describe('server/lib/maps/map-owner-notification-service', () => {
  let redis: FakeRedisSubscriber
  let addNotification: ReturnType<typeof vi.fn>
  let service: MapOwnerNotificationService

  beforeEach(() => {
    redis = new FakeRedisSubscriber()
    addNotification = vi.fn(async () => {})
    service = new MapOwnerNotificationService(
      redis as unknown as RedisSubscriber,
      { addNotification } as unknown as NotificationService,
    )
  })

  test('subscribes to the mapOwner channel', () => {
    expect(service).toBeDefined()
    expect(redis.subscribe).toHaveBeenCalledWith('mapOwner', expect.any(Function))
  })

  test.each(['claimGranted', 'claimRejected'] as const)('notifies the claimant: %s', kind => {
    redis.emit('mapOwner', {
      type: kind,
      data: { claimId: 'claim', familyId: FAMILY_ID, claimantId: CLAIMANT, name: 'Cool Map' },
    })

    expect(addNotification).toHaveBeenCalledWith({
      userId: CLAIMANT,
      data: {
        type: NotificationType.MapOwner,
        familyId: FAMILY_ID,
        mapName: 'Cool Map',
        event: { kind },
      },
    })
  })

  test.each(['ownerSet', 'ownershipRemoved'] as const)('notifies the owner: %s', kind => {
    redis.emit('mapOwner', {
      type: kind,
      data: { familyId: FAMILY_ID, ownerId: OWNER, name: 'Cool Map' },
    })

    expect(addNotification).toHaveBeenCalledWith({
      userId: OWNER,
      data: {
        type: NotificationType.MapOwner,
        familyId: FAMILY_ID,
        mapName: 'Cool Map',
        event: { kind },
      },
    })
  })

  test.each(['fileAdded', 'fileRemoved'] as const)('notifies the owner: %s', kind => {
    redis.emit('mapOwner', {
      type: kind,
      data: {
        familyId: FAMILY_ID,
        ownerId: OWNER,
        fileId: FILE_ID,
        fileName: 'Cool Map v2',
        name: 'Cool Map',
        actorId: ACTOR,
      },
    })

    expect(addNotification).toHaveBeenCalledWith({
      userId: OWNER,
      data: {
        type: NotificationType.MapOwner,
        familyId: FAMILY_ID,
        mapName: 'Cool Map',
        event: { kind, actorId: ACTOR, fileId: FILE_ID, fileName: 'Cool Map v2' },
      },
    })
  })

  test('ignores unknown message types', () => {
    redis.emit('mapOwner', { type: 'somethingElse', data: {} })

    expect(addNotification).not.toHaveBeenCalled()
  })
})
