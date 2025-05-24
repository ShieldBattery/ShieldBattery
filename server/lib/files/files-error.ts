import { FilesErrorCode } from '../../../common/files'
import { CodedError } from '../errors/coded-error'

export class FilesError extends CodedError<FilesErrorCode> {}
