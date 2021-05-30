import { Draft, Immutable, produce } from 'immer'
import { ReduxAction } from '../action-types'

type ReducerFunc<ActionType extends ReduxAction, S> = (state: S, action: ActionType) => S

type AllActionTypes = ReduxAction['type']

type ReducerMap<S> = {
  [A in AllActionTypes]?: ReducerFunc<Extract<ReduxAction, { type: A }>, S>
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
export function keyedReducer<S>(defaultState: S, reducerObject: ReducerMap<S>) {
  return (state = defaultState, action: { type: string }) => {
    if (reducerObject.hasOwnProperty(action.type)) {
      const mapping = reducerObject as Record<string, ReducerFunc<ReduxAction, S>>
      return mapping[action.type](state, action as any)
    } else {
      return state
    }
  }
}

// TODO(tec27): If immer ends up being our choice, delete the non-immer stuff and rename these to
// remove the prefix
type ImmerReducerFunc<ActionType extends ReduxAction, S> = (
  state: Draft<S>,
  action: ActionType,
  originalState: Immutable<S>,
) => Draft<S> | void | undefined

type ImmerReducerMap<S> = {
  [A in AllActionTypes]?: ImmerReducerFunc<Extract<ReduxAction, { type: A }>, S>
}

/**
 * Creates a reducer from an object with a function per action type. This reducer automatically
 * calls immer's `produce` function, so the sub-functions will receive a mutable draft state.
 *
 * @example
 * immerKeyedReducer<MyState>({
 *   [ACTION_ONE](state, action) {
 *     // ...
 *   },
 *
 *   [ACTION_TWO](state, action) {
 *     // ...
 *   }
 * })
 */
export function immerKeyedReducer<S>(defaultState: S, reducerObject: ImmerReducerMap<S>) {
  return (state = defaultState, action: { type: string }) => {
    if (reducerObject.hasOwnProperty(action.type)) {
      const mapping = reducerObject as Record<string, ImmerReducerFunc<ReduxAction, S>>
      return produce(state, draft =>
        mapping[action.type](draft, action as any, state as Immutable<S>),
      )
    } else {
      return state
    }
  }
}
