// eslint-disable-next-line no-restricted-imports
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux'
import { ReduxAction } from './action-types.js'
import { DispatchFunction } from './dispatch-registry.js'
import { RootState } from './root-reducer.js'

/**
 * A hook to access the Redux `dispatch` function.
 */
export const useAppDispatch = () => {
  // NOTE(tec27): This used to work via the generic parameter, but at some point the action types
  // between our declarations and the react-redux one started clashing in ways that I can't quite
  // understand, so doing a dumb cast for now
  return useDispatch() as unknown as DispatchFunction<ReduxAction>
}

/**
 * A hook to access the redux store's state. This hook takes a selector function
 * as an argument. The selector is called with the store state.
 *
 * This hook takes an optional equality comparison function as the second parameter
 * that allows you to customize the way the selected state is compared to determine
 * whether the component needs to be re-rendered.
 *
 * @param selector the selector function
 * @param equalityFn the function that will be used to determine equality
 *
 * @returns the selected state
 *
 * @example
 *
 * export const CounterComponent = () => {
 *   const counter = useSelector(state => state.counter)
 *   return <div>{counter}</div>
 * }
 */
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
