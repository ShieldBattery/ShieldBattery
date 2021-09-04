import { SbUserId } from '../../../common/users/user-info'

/**
 * Keeps track of the user's IP address in our database. This indirection is necessary so we don't
 * need database access in tests.
 *
 * Meant to be used with tsyringe's dependency injection system, so it can easily be mocked out in
 * tests. The injection token is the same as the function name, i.e. "updateOrInsertUserIp".
 */
export type UpdateOrInsertUserIp = (userId: SbUserId, ipAddress: string) => Promise<void>
