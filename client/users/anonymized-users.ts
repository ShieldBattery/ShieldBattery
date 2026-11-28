import { createContext } from 'react'
import { SbUserId } from '../../common/users/sb-user-id'

/** Display-only aliases for a surface that hides identities, including avatars and profile access. */
export const AnonymizedUsersContext = createContext<ReadonlyMap<SbUserId, string>>(new Map())
