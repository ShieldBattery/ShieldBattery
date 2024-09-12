import { MatchmakingServiceErrorCode } from '../../../common/matchmaking.js'
import { CodedError } from '../errors/coded-error.js'

export class MatchmakingServiceError extends CodedError<MatchmakingServiceErrorCode> {}
