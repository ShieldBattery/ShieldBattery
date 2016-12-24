// Used to decorate classes that contain methods that can be INVOKE'd, allowing them to specify a
// base path that all methods should be mounted at.
const MOUNT_PATH = Symbol('mountPath')
export function Mount(path) {
  return function(target) {
    target.prototype[MOUNT_PATH] = path
  }
}

// Used to decorate class methods that can be INVOKE'd.
// Middleware can be a string or a function. Strings will be called on the API object (and bound to
// the API instance), functions will be called directly (unbound).
const API_METHODS = Symbol('apiMethods')
export function Api(path, ...middleware) {
  return function(target, key, descriptor) {
    target[API_METHODS] = target[API_METHODS] || new Map()
    target[API_METHODS].set(key, { path, middleware })
  }
}

export function registerApiRoutes(apiObject, nydus) {
  const proto = Object.getPrototypeOf(apiObject)
  const basePath = proto[MOUNT_PATH]
  if (!basePath) throw new Error('@Mount must be specified to use annotated API methods')
  if (!basePath.startsWith('/') || basePath.endsWith('/')) {
    throw new Error('@Mount path must start with a / and cannot end with a /')
  }

  for (const [method, desc] of proto[API_METHODS].entries()) {
    if (!desc.path.startsWith('/')) throw new Error('Method paths must start with a /')

    const middleware =
        desc.middleware.map(f => typeof f === 'string' ? apiObject[f].bind(apiObject) : f)
    nydus.registerRoute(`${basePath}${desc.path}`,
        ...middleware, apiObject[method].bind(apiObject))
  }
}
