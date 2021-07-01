import { Permissions } from './permissions'

/** Information about the current user and their capabilities that is transmitted to the client. */
export interface SelfUserInfo {
  user: SelfUser
  permissions: Permissions
}

/** Information about the current user. */
export interface SelfUser {
  id: number
  name: string
  email: string
  emailVerified: boolean
}

/** Information about any user in the system. */
export interface User {
  id: number
  name: string
}

/** Information returned for /users/:id/profile, intended to be able to fill out a profile page. */
export interface GetUserProfilePayload {
  user: User
  // TODO(tec27): Add more stuff
}
