import { immerKeyedReducer } from '../reducers/keyed-reducer'

interface NewsState {
  lastUrgentMessageDate?: number
}

const DEFAULT_STATE: NewsState = {}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@news/urgentMessageChange'](state, { payload }) {
    state.lastUrgentMessageDate = payload.publishedAt
  },
})
