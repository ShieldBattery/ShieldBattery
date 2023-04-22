/** An event that's sent to the client to let them know their client sockets are now subscribed. */
export interface SubscribedClientEvent {
  type: 'subscribedClient'
}

/** An event that's sent to the client to let them know their user sockets are now subscribed. */
export interface SubscribedUserEvent {
  type: 'subscribedUser'
}
