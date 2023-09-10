interface SqlContext {
  fragments: Map<SqlTemplate, string>
  values: unknown[]
}

interface ResolvedSqlTemplate {
  text: string
  values: unknown[]
}

/**
 * A string of SQL containing literal strings and interpolated values, generally created via a
 * tagged template literal. `SqlTemplate`'s are immutable once created.
 *
 * The template will be lazily resolved the first time its text or values are accessed.
 */
export class SqlTemplate {
  private resolved: ResolvedSqlTemplate | undefined = undefined

  /** Don't call this directly, use the helper functions. */
  constructor(
    private strings: ReadonlyArray<string>,
    private templateValues: ReadonlyArray<unknown> = [],
  ) {}

  private resolve(): ResolvedSqlTemplate {
    if (!this.resolved) {
      const context: SqlContext = {
        fragments: new Map(),
        values: [],
      }
      const text = this.resolveWithContext(context)
      this.resolved = { text, values: context.values }
    }

    return this.resolved
  }

  private resolveWithContext(context: SqlContext): string {
    let fragment = context.fragments.get(this)
    if (!fragment) {
      fragment = this.strings.reduce((previous, current, i) => {
        const child = this.templateValues[i - 1]

        let mid: string
        if (child instanceof SqlTemplate) {
          mid = child.resolveWithContext(context)
        } else {
          mid = `$${context.values.push(child)}`
        }

        return previous + mid + current
      })

      context.fragments.set(this, fragment)
    }

    return fragment
  }

  /**
   * Returns a new `SqlTemplate` with the specified template appended to the current one. Note: if
   * you are appending a lot of things, it will generally be more efficient to use `sqlConcat` on
   * all of them at once.
   *
   * @example
   * let query = sql`SELECT * FROM users WHERE id = ${userId}`
   * if (userName) {
   *   query = query.append(sql` AND name = ${userName}`)
   * }
   */
  append(template: SqlTemplate): SqlTemplate {
    return sql`${this}${template}`
  }

  get text(): string {
    return this.resolve().text
  }

  get values(): unknown[] {
    return this.resolve().values
  }

  toString(): string {
    return `SqlTemplate("${this.text}")`
  }
}

/**
 * Create a SQL template, with any interpolated values automatically passed as query parameters as
 * necessary. Intended to be used as a tagged template literal.
 *
 * @example
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`
 * const nestedQuery = sql`WITH targetUsers AS (${query}) SELECT * FROM targetUsers`
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlTemplate {
  return new SqlTemplate(strings, values)
}

/**
 * Create a SQL template from a raw string. When used for an interpolated value, the string will be
 * passed directly in the query text rather than as a query parameter. This should *NEVER* be used
 * for unsanitized user input.
 *
 * @example
 * const targetTable = 'users'
 * const query = sql`SELECT * FROM ${sqlRaw(targetTable)} WHERE id = ANY(${userIds})`
 */
export function sqlRaw(str: string): SqlTemplate {
  return new SqlTemplate([str])
}

/**
 * Concatenates multiple SQL templates together, with the given separator between each template.
 * Note that `separator` should NEVER be unsanitized user input, as it will be passed directly in
 * the query text.
 *
 * @example
 * let query = sql`UPDATE users SET `
 * query = query.append(sqlConcat(', ', Object.entries(updates).map(([key, value]) => {
 *   return sql`${sqlRaw(key)} = ${value}`
 * })))
 */
export function sqlConcat(separator: string, templates: ReadonlyArray<SqlTemplate>): SqlTemplate {
  const strings = new Array(templates.length).fill(separator)
  // Remove the separator before/after all the templates
  strings[0] = ''
  strings.push('')

  return new SqlTemplate(strings, templates)
}
