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
  return strings.length && strings[0].startsWith('/')
    ? '/api/1' + urlPath(strings, ...values)
    : '/api/1/' + urlPath(strings, ...values)
}

/**
 * Tagged template literal that constructs the path part of a url where any variable parts will be
 * properly encoded for inclusion in the URL. Can be appended to other strings (whether they are
 * created from this function or not).
 *
 * Example:
 * ```ts
 * urlPath`/lobbies/${lobbyName}/loading`
 * ```
 */
export function urlPath(strings: TemplateStringsArray, ...values: unknown[]) {
  return strings
    .map((str, i) => {
      if (values[i] instanceof URLSearchParams) {
        return str + String(values[i])
      } else {
        const value = values[i] === undefined ? '' : encodeURIComponent(String(values[i]))
        return str + value
      }
    })
    .join('')
}
