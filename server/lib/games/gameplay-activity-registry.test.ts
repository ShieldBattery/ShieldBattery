import { beforeEach, describe, expect, test, vi } from 'vitest'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ActivityStatusService } from '../users/activity-status-service'
import { ClientSocketsGroup } from '../websockets/socket-groups'
import { GameplayActivityRegistry } from './gameplay-activity-registry'

const USER_ID = makeSbUserId(1)

describe('games/gameplay-activity-registry', () => {
  let statusService: {
    setActivity: ReturnType<typeof vi.fn>
    clearActivity: ReturnType<typeof vi.fn>
  }
  let registry: GameplayActivityRegistry
  const client = { isConnected: () => true } as unknown as ClientSocketsGroup

  beforeEach(() => {
    statusService = { setActivity: vi.fn(), clearActivity: vi.fn() }
    registry = new GameplayActivityRegistry(statusService as unknown as ActivityStatusService)
  })

  test('publishes and clears the status an activity shows', () => {
    expect(registry.registerActiveClient(USER_ID, client, FriendActivityStatus.InLobby)).toBe(true)
    expect(statusService.setActivity).toHaveBeenCalledWith(USER_ID, FriendActivityStatus.InLobby)

    registry.reapplyStatus(USER_ID)
    expect(statusService.setActivity).toHaveBeenCalledTimes(2)

    expect(registry.unregisterClientForUser(USER_ID)).toBe(true)
    expect(statusService.clearActivity).toHaveBeenCalledWith(USER_ID, FriendActivityStatus.InLobby)
  })

  test('holds an activity that shows no status without publishing one', () => {
    expect(registry.registerActiveClient(USER_ID, client, undefined)).toBe(true)
    expect(registry.getClientForUser(USER_ID)).toBe(client)
    expect(registry.registerActiveClient(USER_ID, client, FriendActivityStatus.InQueue)).toBe(false)

    registry.reapplyStatus(USER_ID)
    expect(registry.unregisterClientForUser(USER_ID)).toBe(true)

    expect(statusService.setActivity).not.toHaveBeenCalled()
    expect(statusService.clearActivity).not.toHaveBeenCalled()
    expect(registry.getClientForUser(USER_ID)).toBeUndefined()
  })
})
