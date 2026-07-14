import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { PageMetadataContext } from '../page-metadata/page-metadata'
import { findUserById } from './user-model'
import { userPageMetadata } from './user-page-meta'

vi.mock('./user-model', () => ({
  findUserById: vi.fn(),
}))

const findUserByIdMock = asMockedFunction(findUserById)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

const BASE_USER: SbUser = {
  id: makeSbUserId(123),
  name: 'tec27',
  created: new Date('2026-07-15T12:00:00.000Z').getTime(),
}

describe('users/user-page-meta', () => {
  describe('userPageMetadata', () => {
    beforeEach(() => {
      findUserByIdMock.mockReset()
    })

    test('returns undefined for a non-numeric id without querying the model', async () => {
      expect(await userPageMetadata({ id: 'not-a-number' }, CONTEXT)).toBeUndefined()
      expect(await userPageMetadata({ id: '12a' }, CONTEXT)).toBeUndefined()
      expect(await userPageMetadata({ id: '-5' }, CONTEXT)).toBeUndefined()

      expect(findUserByIdMock).not.toHaveBeenCalled()
    })

    test('returns undefined when the id param is missing without querying the model', async () => {
      const result = await userPageMetadata({ id: undefined }, CONTEXT)

      expect(result).toBeUndefined()
      expect(findUserByIdMock).not.toHaveBeenCalled()
    })

    test('returns undefined for an id overflowing int4 without querying the model', async () => {
      const result = await userPageMetadata({ id: '99999999999' }, CONTEXT)

      expect(result).toBeUndefined()
      expect(findUserByIdMock).not.toHaveBeenCalled()
    })

    test('returns undefined when the user is not found', async () => {
      findUserByIdMock.mockResolvedValueOnce(undefined)

      const result = await userPageMetadata({ id: '123' }, CONTEXT)

      expect(result).toBeUndefined()
    })

    test('uses the default page image and no cardType when there is no avatar', async () => {
      findUserByIdMock.mockResolvedValueOnce({ ...BASE_USER })

      const result = await userPageMetadata({ id: '123' }, CONTEXT)

      expect(result).toEqual({
        url: 'https://shieldbattery.net/users/123/tec27',
        type: 'website',
        title: 'tec27',
        description:
          "View tec27's match history, rankings, and stats on ShieldBattery. Playing since July 2026.",
        image: 'https://shieldbattery.net/images/logo-and-text-1200x630.png',
        cardType: undefined,
      })
    })

    test('uses the avatar and a summary cardType when an avatar is present', async () => {
      findUserByIdMock.mockResolvedValueOnce({
        ...BASE_USER,
        avatarUrl: 'https://cdn.example.com/avatars/tec27.jpg',
      })

      const result = await userPageMetadata({ id: '123' }, CONTEXT)

      expect(result?.image).toBe('https://cdn.example.com/avatars/tec27.jpg')
      expect(result?.cardType).toBe('summary')
    })

    test('url-encodes characters in the username', async () => {
      findUserByIdMock.mockResolvedValueOnce({ ...BASE_USER, name: 'Foo Bar/Baz' })

      const result = await userPageMetadata({ id: '123' }, CONTEXT)

      expect(result?.url).toBe('https://shieldbattery.net/users/123/Foo%20Bar%2FBaz')
    })
  })
})
