/**
 * Returns the first value of a Koa `ctx.query` value. Koa will make these values an array if there
 * are multiple params with the same name, but leaves them as a string if there is only one, which
 * makes handling these values annoying if you're only expecting a single entry.
 */
export function getSingleQueryParam(param: string | string[] | undefined): string | undefined {
  return Array.isArray(param) ? param[0] : param
}
