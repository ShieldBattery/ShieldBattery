import { SbUserId } from '../../../common/users/sb-user-id'
import isDev from '../env/is-dev'
import { getDevelopmentClientUsers } from '../models/permissions'

/** Checks current permissions, without exempting other clients belonging to these accounts. */
export async function authorizeDevelopmentClients(userIds: readonly SbUserId[]): Promise<void> {
  if (!userIds.length || isDev) return
  const allowed = await getDevelopmentClientUsers([...userIds])
  if (userIds.some(id => !allowed.has(id))) {
    throw new Error('Development clients require permission')
  }
}
