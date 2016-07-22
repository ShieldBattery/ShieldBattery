/*
Allows for using an object with a function per action type as a reducer.

Example:
const myReducers = {
  [ACTION_ONE](state, action) {
    // ...
  },

  [ACTION_TWO](state, action) {
    // ...
  }
}
*/
export default function keyedReducer(defaultState, reducerObject) {
  return (state = defaultState, action) => {
    return (reducerObject.hasOwnProperty(action.type) ?
      reducerObject[action.type](state, action) :
      state)
  }
}
