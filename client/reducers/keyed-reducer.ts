import { ReduxAction } from '../action-types'

type ReducerFunc<ActionType extends ReduxAction, S> = (state: S, action: ActionType) => S

type AllActionTypes = ReduxAction['type']

type ReducerMap<S> = {
  [A in AllActionTypes]: ReducerFunc<Extract<ReduxAction, { type: A }>, S> | undefined
}

/**
 * Creates a reducer from an object with a function per action type.
 *
 * Example:
 * ```ts
 * keyedReducer<MyState>({
 *   [ACTION_ONE](state, action) {
 *     // ...
 *   },
 *
 *   [ACTION_TWO](state, action) {
 *     // ...
 *   }
 * })
 * ```
 */
export default function keyedReducer<S>(defaultState: S, reducerObject: ReducerMap<S>) {
  return (state = defaultState, action: { type: string }) => {
    return reducerObject.hasOwnProperty(action.type)
      ? reducerObject[action.type as AllActionTypes]!(state, action as any)
      : state
  }
}
