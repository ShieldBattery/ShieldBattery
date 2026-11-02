import { describe, expect, it } from 'vitest'
import { MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { matchmakingPreferencesValidator } from './matchmaking-validators'

describe('matchmaking preferences race validation', () => {
  const userId = makeSbUserId(1)
  const preferences = {
    userId,
    matchmakingType: MatchmakingType.Match1v1,
    mapPoolId: 1,
    mapSelections: [],
    data: {},
  }

  it('allows map edits without a selected race', () => {
    const validator = matchmakingPreferencesValidator(userId)
    expect(validator.validate(preferences).error).toBeUndefined()
    expect(validator.validate({ ...preferences, race: null }).error).toBeUndefined()
  })

  it('requires a valid race for queue preferences', () => {
    const validator = matchmakingPreferencesValidator(userId, false)
    expect(validator.validate(preferences).error).toBeDefined()
    expect(validator.validate({ ...preferences, race: null }).error).toBeDefined()
    expect(validator.validate({ ...preferences, race: 'r' }).error).toBeUndefined()
  })
})
