import { assertUnreachable } from '../../../common/assert-unreachable.js'
import { UserRelationshipServiceErrorCode } from '../../../common/users/relationships.js'
import { UserErrorCode } from '../../../common/users/sb-user.js'
import { CodedError, makeErrorConverterMiddleware } from '../errors/coded-error.js'
import { asHttpError } from '../errors/error-with-payload.js'
import { UserRelationshipServiceError } from './user-relationship-service.js'

export class UserApiError extends CodedError<UserErrorCode> {}

export const convertUserApiErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof UserApiError)) {
    throw err
  }

  switch (err.code) {
    case UserErrorCode.NotFound:
      throw asHttpError(404, err)
    case UserErrorCode.NotAllowedOnSelf:
      throw asHttpError(400, err)
    case UserErrorCode.InvalidCode:
      throw asHttpError(410, err)
    case UserErrorCode.InvalidCredentials:
      throw asHttpError(403, err)
    case UserErrorCode.AccountBanned:
      throw asHttpError(403, err)
    case UserErrorCode.SessionExpired:
      throw asHttpError(410, err)
    case UserErrorCode.UsernameTaken:
      throw asHttpError(409, err)
    case UserErrorCode.SuspiciousActivity:
      throw asHttpError(403, err)
    case UserErrorCode.MachineBanned:
      throw asHttpError(403, err)

    default:
      assertUnreachable(err.code)
  }
})

export const convertUserRelationshipServiceErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof UserRelationshipServiceError)) {
    throw err
  }

  switch (err.code) {
    case UserRelationshipServiceErrorCode.BlockedByUser:
      throw asHttpError(403, err)
    case UserRelationshipServiceErrorCode.InvalidSelfAction:
      throw asHttpError(400, err)
    case UserRelationshipServiceErrorCode.LimitReached:
      throw asHttpError(403, err)
    case UserRelationshipServiceErrorCode.NoMatchingEntry:
      throw asHttpError(404, err)

    default:
      assertUnreachable(err.code)
  }
})
