export type NetworkActions = NetworkConnect | NetworkDisconnect

export interface NetworkConnect {
  type: '@network/connect'
}

export interface NetworkDisconnect {
  type: '@network/disconnect'
}
