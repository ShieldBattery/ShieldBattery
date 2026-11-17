import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { SoloGameLaunchFailure, SoloGameServiceErrorCode } from '../../common/solo-games'
import { FetchError } from '../network/fetch-errors'
import {
  soloGameGenericErrorMessage,
  soloGameLaunchFailureMessage,
  soloGameRequestErrorMessage,
  soloGameServiceErrorMessage,
} from './solo-game-errors'

const t = ((_key: string, defaultValue: string) => defaultValue) as unknown as TFunction

function fetchError(status: number, code?: string): FetchError {
  const res = { status, statusText: 'nope', url: 'http://example.org/api/1/solo-games' }
  return new FetchError(res as Response, code ? JSON.stringify({ code }) : '')
}

describe('soloGameServiceErrorMessage', () => {
  test.each(Object.values(SoloGameServiceErrorCode))('has wording of its own for %s', code => {
    const message = soloGameServiceErrorMessage(code, t)
    expect(message).toBeTruthy()
    expect(message).not.toBe(soloGameGenericErrorMessage(t))
  })
})

describe('soloGameLaunchFailureMessage', () => {
  test.each(Object.values(SoloGameLaunchFailure))('has wording of its own for %s', reason => {
    const message = soloGameLaunchFailureMessage(reason, t)
    expect(message).toBeTruthy()
    expect(message).not.toBe(soloGameGenericErrorMessage(t))
  })

  test('falls back to the generic wording for a reason it predates', () => {
    expect(soloGameLaunchFailureMessage('somethingNew' as SoloGameLaunchFailure, t)).toBe(
      soloGameGenericErrorMessage(t),
    )
  })
})

describe('soloGameRequestErrorMessage', () => {
  test("words a refusal by the server's code", () => {
    expect(
      soloGameRequestErrorMessage(fetchError(409, SoloGameServiceErrorCode.AlreadyInGame), t),
    ).toBe(soloGameServiceErrorMessage(SoloGameServiceErrorCode.AlreadyInGame, t))
  })

  test('words a throttled request', () => {
    expect(soloGameRequestErrorMessage(fetchError(429), t)).not.toBe(soloGameGenericErrorMessage(t))
  })

  test('falls back to the generic wording for an unknown code', () => {
    expect(soloGameRequestErrorMessage(fetchError(400, 'somethingElse'), t)).toBe(
      soloGameGenericErrorMessage(t),
    )
  })

  test('falls back to the generic wording for an error that is not from the server', () => {
    expect(soloGameRequestErrorMessage(new Error('offline'), t)).toBe(
      soloGameGenericErrorMessage(t),
    )
  })
})
