import Joi from 'joi'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingPreferences,
  MatchmakingPreferencesData1v1,
  MatchmakingType,
} from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/user-info'

export function matchmakingPreferencesValidator(forUserId: SbUserId) {
  return Joi.object<MatchmakingPreferences>({
    userId: Joi.number().valid(forUserId).required(),
    matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
    race: Joi.string().valid('p', 't', 'z', 'r').required(),
    mapPoolId: Joi.number().min(1).required(),
    // TODO(2Pac): min/max values most likely depend on the matchmaking type here
    mapSelections: Joi.array().items(Joi.string()).min(0).max(3).required(),
    data: Joi.alternatives()
      .conditional('matchmakingType', {
        is: MatchmakingType.Match1v1,
        then: Joi.object<MatchmakingPreferencesData1v1>({
          useAlternateRace: Joi.bool(),
          alternateRace: Joi.string().valid('p', 't', 'z'),
        }),
      })
      .conditional('matchmakingType', {
        is: MatchmakingType.Match2v2,
        then: Joi.object<Record<string, never>>(),
      })
      .required(),
  })
}
