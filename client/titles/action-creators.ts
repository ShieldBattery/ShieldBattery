import { TitleId } from '../../common/titles'
import {
  AdminGetUserTitlesResponse,
  EquipTitleRequest,
  EquipTitleResponse,
  GetSelfTitlesResponse,
} from '../../common/titles-network'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'

/** Opens the dialog the current user picks their displayed title in. */
export function openTitlePicker(initialSelection?: TitleId): ReturnType<typeof openDialog> {
  return openDialog({ type: DialogType.TitlePicker, initData: { initialSelection } })
}

/** Retrieves the titles the current user holds, and their progress toward the rest. */
export function getSelfTitles(spec: RequestHandlingSpec<GetSelfTitlesResponse>): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<GetSelfTitlesResponse>(apiUrl`titles/me`, { signal: spec.signal })
  })
}

/** Sets the title the current user displays. */
export function equipTitle(
  titleId: TitleId,
  spec: RequestHandlingSpec<EquipTitleResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<EquipTitleResponse>(apiUrl`titles/me/equipped`, {
      method: 'POST',
      body: encodeBodyAsParams<EquipTitleRequest>({ titleId }),
      signal: spec.signal,
    })
    dispatch({ type: '@auth/titleChanged', payload: { user: res.user } })
    return res
  })
}

export function adminGetUserTitles(
  userId: SbUserId,
  spec: RequestHandlingSpec<AdminGetUserTitlesResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<AdminGetUserTitlesResponse>(apiUrl`admin/titles/users/${userId}`, {
      signal: spec.signal,
    })
  })
}

/** Grants (`granted: true`) or revokes a title an admin hands out by hand. */
export function adminSetUserTitleGranted(
  userId: SbUserId,
  titleId: TitleId,
  granted: boolean,
  spec: RequestHandlingSpec<AdminGetUserTitlesResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<AdminGetUserTitlesResponse>(
      apiUrl`admin/titles/users/${userId}/${titleId}`,
      { method: granted ? 'POST' : 'DELETE', signal: spec.signal },
    )
  })
}
