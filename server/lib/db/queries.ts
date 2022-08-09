import { SQLStatement } from 'sql-template-strings'

/**
 * Appends the specified statements to a query in-place, joining adjacent statements (not including
 * the target query) with `separator`.
 *
 * @returns The target query with the statements appended (the same object as the passed-in `query`)

 * @example
 * // NOTE(tec27): CONTRIVED EXAMPLE!!! Normally this code would just use `= ANY(...)`
 * const matches = [1, 2, 3].map(id => sql`id = ${id}`)
 * const query = appendJoined(sql`SELECT * FROM foo WHERE`, matches, sql` OR `)
 */
export function appendJoined(
  query: SQLStatement,
  appendedStatements: ReadonlyArray<SQLStatement>,
  separator: SQLStatement | string = ' ',
): SQLStatement {
  let first = true
  for (const statement of appendedStatements) {
    if (!first) {
      query.append(separator)
    }

    query.append(statement)
    first = false
  }

  return query
}
