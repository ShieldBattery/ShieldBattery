import { immerKeyedReducer } from '../reducers/keyed-reducer'

interface NewsState {
  urgentMessageId?: string
}

const DEFAULT_STATE: NewsState = {}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@news/urgentMessageChange'](state, { payload }) {
    state.urgentMessageId = payload.id
  },
})
