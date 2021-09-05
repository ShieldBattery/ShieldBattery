import { DatabaseError } from 'pg'
import { SYNTAX_ERROR_OR_ACCESS_RULE_VIOLATION } from './pg-error-codes'

export default function handlePgError(query: string, error: unknown): unknown {
  if (
    isDatabaseError(error) &&
    error.code &&
    getErrorClass(error.code) === getErrorClass(SYNTAX_ERROR_OR_ACCESS_RULE_VIOLATION)
  ) {
    return handlePgSyntaxError(query, error)
  } else {
    return error
  }
}

function getErrorClass(code: string): string {
  // By the standard, the first two character denote the class of error
  // https://www.postgresql.org/docs/13/errcodes-appendix.html
  return code.substring(0, 2)
}

function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && error.hasOwnProperty('code') && error.hasOwnProperty('position')
}

function handlePgSyntaxError(queryText: string, error: DatabaseError): Error {
  const messageLines = queryText.split('\n')
  const position = Number(error.position)

  if (!isNaN(position)) {
    let curLine = 0
    let summedLength = 0
    do {
      summedLength += messageLines[curLine].length + 1 // 1 extra for the \n
      curLine += 1
    } while (curLine < messageLines.length && summedLength < position)

    if (summedLength >= position) {
      const foundLine = curLine - 1
      const relativePosition = position - (summedLength - messageLines[foundLine].length)
      const caretLine = '^'.padStart(relativePosition + 1)
      messageLines.splice(curLine, 0, caretLine)
    }
  }

  if (error.hint) {
    messageLines.push(`hint: ${error.hint}`)
  }
  return new Error(`${error.message} in query: \n${messageLines.join('\n')}`)
}
