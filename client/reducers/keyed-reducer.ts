import { castDraft, Draft, Immutable, produce } from 'immer'
import { ReduxAction } from '../action-types'
import { ActionWithSystemInfo } from '../redux-system-info'

type ReducerFunc<ActionType extends ReduxAction, S> = (state: S, action: ActionType) => S

type AllActionTypes = ReduxAction['type']

type ReducerMap<S> = {
  [A in AllActionTypes]?: ReducerFunc<Extract<ReduxAction, { type: A }> & ActionWithSystemInfo, S>
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
/**
 * A reducer function that uses Immer to ensure immutability.
 *
 * @param state A draft state that can be mutated into the new, resulting state
 * @param action The actin that triggered this reducer run
 * @param originalState A copy of the state as it existed before this reducer was run. This is
 *   immutable and is mainly useful as a reference.
 *
 * @returns In most cases, no value will be returned, and Immer will use the mutations to the draft
 *   state to update things. If you need to reset to the default state, returning the default state
 *   will work. You may also return the draft state, or a completely new object to replace the
 *   state.
 */
type ImmerReducerFunc<ActionType extends ReduxAction, S> = (
  state: Draft<S>,
  action: ActionType,
  originalState: Immutable<S>,
) => S | Immutable<S> | Draft<S> | void

type ImmerReducerMap<S> = {
  [A in AllActionTypes]?: ImmerReducerFunc<
    Extract<ReduxAction, { type: A }> & ActionWithSystemInfo,
    S
  >
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
        // NOTE(tec27): The castDraft here is necessary to allow `defaultState` to be a valid return
        castDraft(mapping[action.type](draft, action as any, state as Immutable<S>)),
      )
    } else {
      return state
    }
  }
}
