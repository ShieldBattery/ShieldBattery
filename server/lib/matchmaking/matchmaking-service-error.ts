import { MatchmakingServiceErrorCode } from '../../../common/matchmaking'
import { CodedError } from '../errors/coded-error'

export class MatchmakingServiceError extends CodedError<MatchmakingServiceErrorCode> {}
