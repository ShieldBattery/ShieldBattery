import { NydusServer, RouteHandler } from 'nydus'

// Used to decorate classes that contain methods that can be INVOKE'd, allowing them to specify a
// base path that all methods should be mounted at.
const MOUNT_PATH = Symbol('mountPath')
/**
 * Decorate a class as a websocket API with methods that can be INVOKE'd. This specifies the base
 * path at which all the methods should be mounted.
 *
 * @param path A path that will be prepended to all the `@Api` methods' paths.
 */
export function Mount(path: string) {
  return (target: any) => {
    target.prototype[MOUNT_PATH] = path
  }
}

const API_METHODS = Symbol('apiMethods')

interface ApiMethodRegistration {
  path: string
  middleware: Array<string | RouteHandler>
}
type ApiMethodsMap = Map<string, ApiMethodRegistration>
type ApiClassPrototype = {
  [MOUNT_PATH]: string | undefined
  [API_METHODS]: ApiMethodsMap | undefined
}

/**
 * Decorate a method as INVOKE-able.
 *
 * @param path The path this function can be INVOKEd through (appended to the `@Mount()` path)
 * @param middleware A list of functions or strings to be called (in order) when this method is
 *     INVOKEd. Strings will be treated as a method name on the current class and be called with
 *     their context bound to the API class instance. Functions will be called directly (no special
 *     context binding).
 */
export function Api(path: string, ...middleware: Array<string | RouteHandler>) {
  return function (target: any, key: string) {
    const proto = target as ApiClassPrototype
    proto[API_METHODS] ??= new Map<string, ApiMethodRegistration>()
    proto[API_METHODS]!.set(key, { path, middleware })
  }
}

/**
 * Register the decorated `@Api` methods for a class on a particular `NydusServer` instance.
 */
export function registerApiRoutes(apiObject: any, nydus: NydusServer) {
  const proto = Object.getPrototypeOf(apiObject) as ApiClassPrototype
  const basePath = proto[MOUNT_PATH]
  if (!basePath) throw new Error('@Mount must be specified to use annotated API methods')
  if (!basePath.startsWith('/') || basePath.endsWith('/')) {
    throw new Error('@Mount path must start with a / and cannot end with a /')
  }

  for (const [method, desc] of (
    proto[API_METHODS] ?? new Map<string, ApiMethodRegistration>()
  ).entries()) {
    if (!desc.path.startsWith('/')) throw new Error('Method paths must start with a /')

    const middleware = desc.middleware.map(f =>
      typeof f === 'string' ? apiObject[f].bind(apiObject) : f,
    )
    nydus.registerRoute(`${basePath}${desc.path}`, ...middleware, apiObject[method].bind(apiObject))
  }
}
