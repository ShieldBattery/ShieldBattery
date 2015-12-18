import { expect } from 'chai'

import * as actions from '../../client/actions'

describe('actions', () => {
  it('should have matching keys and values', () => {
    for (const action of Object.keys(actions)) {
      expect(actions[action]).to.equal(action)
    }
  })
})
