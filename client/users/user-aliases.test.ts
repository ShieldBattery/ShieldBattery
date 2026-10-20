import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { jotaiStore } from '../jotai-store'
import {
  findUsersByAlias,
  getGameUserAliases,
  getUserAlias,
  loadUserAliases,
  setUserAlias,
  userAliasesAtom,
} from './user-aliases'

vi.mock('../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

const OWNER = makeSbUserId(1)
const OTHER_OWNER = makeSbUserId(2)
const PLAYER = makeSbUserId(10)
const OTHER_PLAYER = makeSbUserId(11)

describe('client/users/user-aliases', () => {
  beforeEach(() => {
    localStorage.clear()
    loadUserAliases(OWNER)
  })

  afterEach(() => {
    loadUserAliases(undefined)
    localStorage.clear()
  })

  test('aliases persist for the account that made them', () => {
    setUserAlias(PLAYER, 'Boxer')
    expect(getUserAlias(PLAYER)).toBe('Boxer')

    loadUserAliases(undefined)
    expect(getUserAlias(PLAYER)).toBeUndefined()

    loadUserAliases(OWNER)
    expect(getUserAlias(PLAYER)).toBe('Boxer')
  })

  test('each account on the client has its own aliases', () => {
    setUserAlias(PLAYER, 'Boxer')

    loadUserAliases(OTHER_OWNER)
    expect(getUserAlias(PLAYER)).toBeUndefined()
    setUserAlias(PLAYER, 'Nada')

    loadUserAliases(OWNER)
    expect(getUserAlias(PLAYER)).toBe('Boxer')
  })

  test('removing an alias forgets it', () => {
    setUserAlias(PLAYER, 'Boxer')
    setUserAlias(PLAYER, undefined)

    expect(getUserAlias(PLAYER)).toBeUndefined()
    loadUserAliases(OWNER)
    expect(jotaiStore.get(userAliasesAtom).size).toBe(0)
  })

  test('unusable stored entries are skipped', () => {
    localStorage.setItem(
      `${OWNER}|userAliases`,
      JSON.stringify({ [PLAYER]: 'Boxer', abc: 'Nada', [OTHER_PLAYER]: 7, 12: '' }),
    )
    loadUserAliases(OWNER)

    expect(Array.from(jotaiStore.get(userAliasesAtom))).toEqual([[PLAYER, 'Boxer']])
  })

  test('a stored value that is not JSON loads as no aliases', () => {
    localStorage.setItem(`${OWNER}|userAliases`, '{nope')
    loadUserAliases(OWNER)

    expect(jotaiStore.get(userAliasesAtom).size).toBe(0)
  })

  test('aliases are found without regard to case', () => {
    setUserAlias(PLAYER, 'Boxer')

    expect(findUsersByAlias('bOXER')).toEqual([PLAYER])
    expect(findUsersByAlias('Box')).toEqual([])
  })

  test('games get the aliases of players whose names are known', () => {
    setUserAlias(PLAYER, 'Boxer')
    setUserAlias(OTHER_PLAYER, 'Nada')

    expect(getGameUserAliases(id => (id === PLAYER ? 'SlayerS_BoxeR' : undefined))).toEqual([
      { userId: PLAYER, name: 'SlayerS_BoxeR', alias: 'Boxer' },
    ])
  })
})
