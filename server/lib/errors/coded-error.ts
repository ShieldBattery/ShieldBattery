/**
 * A generic Error type that includes a `code` to identify what type of error it is.
 */
export class CodedError<CodeType extends string, DataType = any> extends Error {
  constructor(readonly code: CodeType, message: string, readonly data?: DataType) {
    super(message)
  }
}
