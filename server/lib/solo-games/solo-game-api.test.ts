import { RouterContext } from '@koa/router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbMapId } from '../../../common/maps'
import { SoloGameServiceErrorCode } from '../../../common/solo-games'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { resolveMapId } from '../maps/map-models'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { convertSoloGameServiceError, launchSoloGameBody, SoloGameApi } from './solo-game-api'
import { SoloGameService } from './solo-game-service'
import { SoloGameServiceError } from './solo-game-service-error'

vi.mock('../maps/map-models', () => ({ resolveMapId: vi.fn() }))

const USER_ID = makeSbUserId(7)

/** The HTTP status each service failure is answered with. */
const EXPECTED_STATUS: Record<SoloGameServiceErrorCode, number> = {
  [SoloGameServiceErrorCode.NoActiveClient]: 400,
  [SoloGameServiceErrorCode.MapNotFound]: 404,
  [SoloGameServiceErrorCode.MapNotPlayableAlone]: 400,
  [SoloGameServiceErrorCode.InvalidSlot]: 400,
  [SoloGameServiceErrorCode.InvalidRace]: 400,
  [SoloGameServiceErrorCode.AlreadyInActivity]: 409,
  [SoloGameServiceErrorCode.AlreadyInGame]: 409,
}

function convert(err: unknown): any {
  try {
    convertSoloGameServiceError(err)
  } catch (converted) {
    return converted
  }
  throw new Error('the converter returned without throwing')
}

function makeContext(body: unknown): RouterContext {
  return {
    request: { body },
    session: { user: { id: USER_ID } },
  } as unknown as RouterContext
}

describe('solo-games/solo-game-api/launchSoloGameBody', () => {
  test('accepts a request naming only the client and the map', () => {
    expect(launchSoloGameBody.validate({ clientId: 'c', map: 'm' }).error).toBeUndefined()
  })

  test('accepts a slot and a race', () => {
    expect(
      launchSoloGameBody.validate({ clientId: 'c', map: 'm', slot: 3, race: 'z' }).error,
    ).toBeUndefined()
  })

  test.each([
    ['no client', { map: 'm' }],
    ['no map', { clientId: 'c' }],
    ['a negative slot', { clientId: 'c', map: 'm', slot: -1 }],
    ['a slot past the last one', { clientId: 'c', map: 'm', slot: 12 }],
    ['a fractional slot', { clientId: 'c', map: 'm', slot: 1.5 }],
    ['an unknown race', { clientId: 'c', map: 'm', race: 'x' }],
    ['an unknown field', { clientId: 'c', map: 'm', lobby: true }],
  ])('refuses %s', (_name, body) => {
    expect(launchSoloGameBody.validate(body).error).toBeDefined()
  })
})

describe('solo-games/solo-game-api/convertSoloGameServiceError', () => {
  test.each(Object.values(SoloGameServiceErrorCode))('maps %s', code => {
    const converted = convert(new SoloGameServiceError(code, 'test message'))

    expect(converted.status).toBe(EXPECTED_STATUS[code])
    expect(converted.message).toBe('test message')
    expect(converted.payload).toEqual({ code })
  })

  test('passes other errors through untouched', () => {
    const err = new Error('something else')
    expect(convert(err)).toBe(err)
  })
})

describe('solo-games/solo-game-api/SoloGameApi#launch', () => {
  let launch: ReturnType<typeof vi.fn>
  let getById: ReturnType<typeof vi.fn>
  let api: SoloGameApi

  beforeEach(() => {
    vi.clearAllMocks()
    launch = vi.fn().mockResolvedValue(undefined)
    getById = vi.fn()
    api = new SoloGameApi(
      { launch } as unknown as SoloGameService,
      { getById } as unknown as ClientSocketsManager,
    )
    asMockedFunction(resolveMapId).mockImplementation(async id =>
      id === makeSbMapId('old-id') ? makeSbMapId('new-id') : id,
    )
  })

  test("launches on the resolved map from the user's app client", async () => {
    const client = { userId: USER_ID, clientType: 'electron' }
    getById.mockReturnValue(client)

    await api.launch(makeContext({ clientId: 'app', map: 'old-id', slot: 1, race: 't' }))

    expect(getById).toHaveBeenCalledWith(USER_ID, 'app')
    expect(launch).toHaveBeenCalledWith({
      client,
      mapId: makeSbMapId('new-id'),
      slot: 1,
      race: 't',
    })
  })

  test('refuses a web client', async () => {
    getById.mockReturnValue({ userId: USER_ID, clientType: 'web' })

    await expect(api.launch(makeContext({ clientId: 'web', map: 'm' }))).rejects.toMatchObject({
      code: SoloGameServiceErrorCode.NoActiveClient,
    })
    expect(launch).not.toHaveBeenCalled()
  })

  test('refuses a client that is not connected', async () => {
    getById.mockReturnValue(undefined)

    await expect(api.launch(makeContext({ clientId: 'gone', map: 'm' }))).rejects.toMatchObject({
      code: SoloGameServiceErrorCode.NoActiveClient,
    })
    expect(launch).not.toHaveBeenCalled()
  })

  test('refuses an invalid body before looking anything up', async () => {
    await expect(api.launch(makeContext({ clientId: 'app', map: 'm', slot: 'x' }))).rejects.toThrow(
      /Invalid request body/,
    )
    expect(getById).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })
})
