export interface ChannelPermissions {
  kick: boolean
  ban: boolean
  changeTopic: boolean
  togglePrivate: boolean
  editPermissions: boolean
}

export interface ChannelUser {
  id: number
  name: string
  joinedAt: number
  permissions: ChannelPermissions
}

export interface Channel {
  name: string
  topic: string
  private: boolean
  highTraffic: boolean
}

export interface ChannelInitEvent {
  type: 'init'
  channel: Channel
  activeUsers: ChannelUser[]
}

export interface ChannelJoinEvent {
  type: 'join'
  user: ChannelUser
}

export type ChannelEvent = ChannelInitEvent | ChannelJoinEvent
