import { List, Map, OrderedSet, Record } from 'immutable'
import { WhisperUserStatus } from '../../common/whispers'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { TextMessageRecord } from '../messaging/message-records'
import { keyedReducer } from '../reducers/keyed-reducer'

// How many messages should be kept for inactive channels
const INACTIVE_CHANNEL_MAX_HISTORY = 150

export class Session extends Record({
  target: '',
  status: WhisperUserStatus.Offline,
  messages: List<TextMessageRecord>(),

  loadingHistory: false,
  hasHistory: true,

  activated: false,
  hasUnread: false,
}) {}

export class WhisperState extends Record({
  sessions: OrderedSet<string>(),
  // Note that the keys for this map are always lower-case
  byName: Map<string, Session>(),
  errorsByName: Map<string, string>(),
}) {}

// TODO(tec27): undo this copy-paste
/**
 * Update the messages field for a whisper, keeping the `hasUnread` flag in proper sync.
 *
 * @param updateFn A function which should perform the update operation on the messages field.
 */
function updateMessages(
  state: WhisperState,
  targetName: string,
  updateFn: (messages: List<TextMessageRecord>) => List<TextMessageRecord>,
) {
  return state.updateIn(['byName', targetName], session => {
    const c = session as Session

    let updated = updateFn(c.messages)
    if (updated === c.messages) {
      return c
    }

    let sliced = false
    if (!c.activated && updated.size > INACTIVE_CHANNEL_MAX_HISTORY) {
      updated = updated.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
      sliced = true
    }

    return c
      .set('messages', updated)
      .set('hasUnread', c.hasUnread || !c.activated)
      .set('hasHistory', c.hasHistory || sliced)
  })
}

export default keyedReducer(new WhisperState(), {
  ['@whispers/initSession'](state, action) {
    const { target, targetStatus: status } = action.payload
    const session = new Session({ target: target.name, status })

    return state
      .update('sessions', s => s.add(target.name))
      .setIn(['byName', target.name.toLowerCase()], session)
  },

  ['@whispers/startWhisperSessionBegin'](state, action) {
    const { target } = action.payload
    return state.deleteIn(['errorsByName', target.toLowerCase()])
  },

  ['@whispers/startWhisperSession'](state, action) {
    if (action.error) {
      const { target } = action.meta
      const message =
        "Something went wrong. Please try again and make sure you've entered a" +
        ' correct username.'
      return state.setIn(['errorsByName', target.toLowerCase()], message)
    }

    return state
  },

  ['@whispers/closeSession'](state, action) {
    const { target } = action.payload

    return state
      .update('sessions', s => s.delete(target.name))
      .deleteIn(['byName', target.name.toLowerCase()])
  },

  ['@whispers/updateMessage'](state, action) {
    const {
      message: { id, time, from, to, text },
    } = action.payload
    const target = state.sessions.has(from.name) ? from.name : to.name
    const newMessage = new TextMessageRecord({
      id,
      time,
      from: from.id,
      text,
    })

    return updateMessages(state, target.toLowerCase(), m => m.push(newMessage))
  },

  ['@whispers/updateUserActive'](state, action) {
    const { user } = action.payload
    const name = user.name.toLowerCase()
    const wasIdle = state.byName.get(name)?.status === WhisperUserStatus.Idle
    if (wasIdle) {
      // Don't show online message if the user went from idle -> active
      return state
    }

    return state.setIn(['byName', name, 'status'], WhisperUserStatus.Active)
  },

  ['@whispers/updateUserIdle'](state, action) {
    const { user } = action.payload

    return state.setIn(['byName', user.name.toLowerCase(), 'status'], WhisperUserStatus.Idle)
  },

  ['@whispers/updateUserOffline'](state, action) {
    const { user } = action.payload
    const name = user.name.toLowerCase()

    return state.setIn(['byName', name, 'status'], WhisperUserStatus.Offline)
  },

  ['@whispers/loadMessageHistoryBegin'](state, action) {
    const { target } = action.payload

    // TODO(tec27): Remove cast once Immutable infers types properly
    return state.updateIn(['byName', target.toLowerCase()], s =>
      (s as Session).set('loadingHistory', true),
    )
  },

  ['@whispers/loadMessageHistory'](state, action) {
    if (action.error) {
      // TODO(2Pac): Handle errors
      return state
    }

    const { target, limit } = action.meta
    const name = target.toLowerCase()
    const newMessages = List(
      action.payload.messages.map(
        msg =>
          new TextMessageRecord({
            id: msg.id,
            time: msg.sent,
            from: msg.from.id,
            text: msg.data.text,
          }),
      ),
    )
    let updated = state.setIn(['byName', name, 'loadingHistory'], false)
    if (newMessages.size < limit) {
      updated = updated.setIn(['byName', name, 'hasHistory'], false)
    }

    return updateMessages(updated, name, messages => newMessages.concat(messages))
  },

  ['@whispers/activateWhisperSession'](state, action) {
    const { target } = action.payload
    const name = target.toLowerCase()
    if (!state.byName.has(name)) {
      return state
    }
    return state.updateIn(['byName', name], s => {
      // TODO(tec27): Remove cast once Immutable infers types properly
      return (s as Session).set('hasUnread', false).set('activated', true)
    })
  },

  ['@whispers/deactivateWhisperSession'](state, action) {
    const { target } = action.payload
    const name = target.toLowerCase()
    if (!state.byName.has(name)) {
      return state
    }
    const hasHistory = state.byName.get(name)!.messages.size > INACTIVE_CHANNEL_MAX_HISTORY

    return state.updateIn(['byName', name], session => {
      // TODO(tec27): Remove cast once Immutable infers types properly
      const s = session as Session
      return s
        .set('messages', s.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY))
        .set('hasHistory', s.hasHistory || hasHistory)
        .set('activated', false)
    })
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return new WhisperState()
  },
})
