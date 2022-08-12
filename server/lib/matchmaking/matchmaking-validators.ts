import Joi from 'joi'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingPreferences,
  MatchmakingPreferencesData1v1,
  MatchmakingType,
  PartialMatchmakingPreferences,
} from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user'

function maybeOptional<T extends { required: () => T }>(optional: boolean, schema: T): T {
  return optional ? schema : schema.required()
}

export function matchmakingPreferencesValidator<
  T extends MatchmakingPreferences | PartialMatchmakingPreferences = PartialMatchmakingPreferences,
>(forUserId: SbUserId, allowPartial = true): Joi.ObjectSchema<T> {
  return Joi.object<T>({
    userId: Joi.number().valid(forUserId).required(),
    matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
    race: maybeOptional(allowPartial, Joi.string().valid('p', 't', 'z', 'r')),
    mapPoolId: maybeOptional(allowPartial, Joi.number().min(1)),
    // TODO(2Pac): min/max values most likely depend on the matchmaking type here
    mapSelections: maybeOptional(allowPartial, Joi.array().items(Joi.string()).min(0).max(3)),
    data: maybeOptional(
      allowPartial,
      Joi.alternatives()
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
        }),
    ),
  })
}
