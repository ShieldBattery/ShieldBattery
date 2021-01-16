/**
 * Tagged template literal function that constructs an API url where any variable parts will be
 * properly encoded for inclusion in the URL. API root and version will also be prepended to the
 * string.
 *
 * Example:
 * ```ts
 * apiUrl`matchmakingPreferences/${matchmakingType}`
 * ```
 */
export function apiUrl(strings: TemplateStringsArray, ...values: unknown[]) {
  return (
    '/api/1/' +
    strings
      .map((str, i) => {
        const value = values[i] === undefined ? '' : encodeURIComponent(String(values[i]))
        return str + value
      })
      .join('')
  )
}
