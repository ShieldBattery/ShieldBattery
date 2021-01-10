import { Permissions } from './permissions'

/** Information about the current user that is transmitted to the client. */
export interface UserInfo {
  user: User
  permissions: Permissions
}

export interface User {
  id: number
  name: string
  email: string
  emailVerified: boolean
}
