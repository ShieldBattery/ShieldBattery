interface Action {
  type: string
}

type ReducerFunc<S, ActionType extends Action> = (state: S, action: ActionType) => S

/**
 * Creates a reducer from an object with a function per action type.
 *
 * Example:
 * ```ts
 * keyedReducer<MyState, MyAction>({
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
export default function keyedReducer<S, ActionType extends Action>(
  defaultState: S,
  reducerObject: Record<string, ReducerFunc<S, ActionType>>,
) {
  return (state = defaultState, action: ActionType) => {
    return reducerObject.hasOwnProperty(action.type)
      ? reducerObject[action.type](state, action)
      : state
  }
}
