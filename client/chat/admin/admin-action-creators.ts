import { EditChannelResponse, RenameChannelRequest, SbChannelId } from '../../../common/chat'
import { apiUrl } from '../../../common/urls'
import { ThunkAction } from '../../dispatch-registry'
import { abortableThunk, RequestHandlingSpec } from '../../network/abortable-thunk'
import { fetchJson } from '../../network/fetch'

/**
 * Renames a chat channel as a server moderator. The caller is expected to handle errors.
 */
export function renameChannelAdmin(
  channelId: SbChannelId,
  name: string,
  spec: RequestHandlingSpec<EditChannelResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<EditChannelResponse>(apiUrl`admin/chat/${channelId}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name } satisfies RenameChannelRequest),
      signal: spec.signal,
    })
  })
}

/**
 * Closes a chat channel as a server moderator, removing every member and clearing its owner until
 * it's reopened. The caller is expected to handle errors.
 */
export function closeChannelAdmin(
  channelId: SbChannelId,
  spec: RequestHandlingSpec<EditChannelResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<EditChannelResponse>(apiUrl`admin/chat/${channelId}/close`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

/**
 * Reopens a previously closed chat channel as a server moderator, allowing joins again. The caller
 * is expected to handle errors.
 */
export function reopenChannelAdmin(
  channelId: SbChannelId,
  spec: RequestHandlingSpec<EditChannelResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<EditChannelResponse>(apiUrl`admin/chat/${channelId}/reopen`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

/**
 * Permanently deletes a chat channel as a server moderator, along with its messages and bans, and
 * removes all of its members. The caller is expected to handle errors.
 */
export function deleteChannelAdmin(
  channelId: SbChannelId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`admin/chat/${channelId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}
