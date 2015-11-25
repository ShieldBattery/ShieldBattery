let dispatcherFunc = null

export function registerDispatch(dispatch) {
  dispatcherFunc = dispatch
}

export function dispatch(action) {
  return dispatcherFunc(action)
}
