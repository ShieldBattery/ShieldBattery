import * as actions from './actions'

describe('actions', () => {
  test('should have matching keys and values', () => {
    for (const action of Object.keys(actions)) {
      expect(actions[action]).toBe(action)
    }
  })
})
