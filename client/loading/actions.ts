import { ChatReadyEvent } from '../../common/chat'
import { SubscribedClientEvent, SubscribedUserEvent } from '../../common/websockets'
import { WhispersReadyEvent } from '../../common/whispers'

export type LoadingActions =
  | ChatLoadingComplete
  | SubscriptionsClientLoadingComplete
  | SubscriptionsUserLoadingComplete
  | WhispersLoadingComplete

/**
 * The server has finished giving us our initial chat data (e.g what channels we are in) on connect.
 */
export interface ChatLoadingComplete {
  type: '@loading/chatReady'
  payload: ChatReadyEvent
}

/**
 * The server has finished subscribing this particular client to the things it needs.
 */
export interface SubscriptionsClientLoadingComplete {
  type: '@loading/subscribedClient'
  payload: SubscribedClientEvent
}

/**
 * The server has finished subscribing this user (across clients) to the things it needs.
 */
export interface SubscriptionsUserLoadingComplete {
  type: '@loading/subscribedUser'
  payload: SubscribedUserEvent
}

/**
 * The server has finished giving us our initial whispers data (eg. the list of users we had the
 * whisper window opened with when we last used the site) upon connecting.
 */
export interface WhispersLoadingComplete {
  type: '@loading/whispersReady'
  payload: WhispersReadyEvent
}
