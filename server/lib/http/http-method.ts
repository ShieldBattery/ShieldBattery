/**
 * HTTP request method types.
 *
 * NOTE(tec27): This is not actually exhaustive, but maps to what we actually use and have route
 * decorators for.
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'
