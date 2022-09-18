import Router, { RouterContext } from '@koa/router'
import { PropKey, TypedMethodDecorator } from '../reflect/decorators'
import { MetadataMapValue } from '../reflect/metadata'
import { HttpMethod } from './http-method'

interface RouteDefinition {
  method: HttpMethod
  path: string
}

export const routesMetadata = new MetadataMapValue<
  PropKey,
  RouteDefinition,
  Record<string | symbol, unknown>
>(Symbol('httpApiRoutes'))

type HttpApiMethod = (ctx: RouterContext) => any

function apiMethodDecorator(method: HttpMethod, path: string): TypedMethodDecorator<HttpApiMethod> {
  return function (target, propertyKey) {
    routesMetadata.setEntry(target, propertyKey, { method, path })
  }
}

/**
 * Decorates a method to handle a GET request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpGet(path: string) {
  return apiMethodDecorator('get', path)
}

/**
 * Decorates a method to handle a POST request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpPost(path: string) {
  return apiMethodDecorator('post', path)
}

/**
 * Decorates a method to handle a PUT request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpPut(path: string) {
  return apiMethodDecorator('put', path)
}

/**
 * Decorates a method to handle a DELETE request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpDelete(path: string) {
  return apiMethodDecorator('delete', path)
}

/**
 * Decorates a method to handle a PATCH request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpPatch(path: string) {
  return apiMethodDecorator('patch', path)
}

export const routeMiddlewareMetadata = new MetadataMapValue<
  PropKey,
  Router.Middleware[],
  Record<string | symbol, unknown>
>(Symbol('httpApiRouteMiddleware'))

/**
 * Decorates a method to run the specified middleware functions before handling each request. This
 * should be used alongside one of the `http...` decorators, such as `httpGet` or `httpPost`.
 */
export function httpBefore(
  ...middleware: Router.Middleware[]
): TypedMethodDecorator<HttpApiMethod> {
  return function (target, propertyKey) {
    routeMiddlewareMetadata.setEntry(target, propertyKey, middleware)
  }
}
