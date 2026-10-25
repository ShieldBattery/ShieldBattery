import {
  GetBugReportResponseJson,
  ListBugReportsResponseJson,
  ReportBugRequest,
  ReportBugResponse,
} from '../../common/bugs'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'

const ipcRenderer = new TypedIpcRenderer()

export function reportBug(
  report: ReportBugRequest,
  spec: RequestHandlingSpec<ReportBugResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const reportFiles = await ipcRenderer.invoke('bugReportCollectFiles')!
    const filesBlob = new Blob([reportFiles], { type: 'application/zip' })
    const formData = new FormData()
    formData.append('details', report.details)
    formData.append('logs', filesBlob, 'logs.zip')

    return await fetchJson(apiUrl`/bugs`, { method: 'POST', body: formData, signal: spec.signal })
  })
}

/**
 * Files a bug report without involving the user, for a replay the server rejected (with error
 * `code`). The report carries the logs plus the replay itself.
 */
export async function sendReplayDiagnosticReport(
  gameId: string,
  replayPath: string,
  code: string,
): Promise<ReportBugResponse> {
  const reportFiles = await ipcRenderer.invoke('bugReportCollectFiles', { replayPath })!
  const formData = new FormData()
  formData.append(
    'details',
    `Automatic report: the server rejected the replay for game ${gameId} (${code}).`,
  )
  formData.append('logs', new Blob([reportFiles], { type: 'application/zip' }), 'logs.zip')

  return await fetchJson(apiUrl`/bugs`, { method: 'POST', body: formData })
}

export function adminListBugReports(
  includeResolved: boolean,
  spec: RequestHandlingSpec<ListBugReportsResponseJson>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<ListBugReportsResponseJson>(
      apiUrl`/bugs` + (includeResolved ? '?includeResolved' : ''),
      {
        signal: spec.signal,
      },
    )
    dispatch({
      type: '@users/loadUsers',
      payload: result.users,
    })
    return result
  })
}

export function adminGetBugReport(
  reportId: string,
  spec: RequestHandlingSpec<GetBugReportResponseJson>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetBugReportResponseJson>(apiUrl`/bugs/${reportId}`, {
      signal: spec.signal,
    })
    dispatch({
      type: '@users/loadUsers',
      payload: result.users,
    })
    return result
  })
}

export function adminResolveBugReport(
  reportId: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`/bugs/${reportId}/resolve`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}
