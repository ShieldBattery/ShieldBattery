import { SoloGameServiceErrorCode } from '../../../common/solo-games'
import { CodedError } from '../errors/coded-error'

export class SoloGameServiceError extends CodedError<SoloGameServiceErrorCode> {}
