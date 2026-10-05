import { atom } from 'jotai'
import { AdminReportKind } from '../../common/admin-report-counts'

/**
 * Creation times of the recent unresolved reports of each kind, as last pushed by the server. Only
 * populated for kinds the current user has permission to manage.
 */
export const adminReportTimesAtom = atom<Readonly<Record<AdminReportKind, readonly number[]>>>({
  bugReports: [],
  gameReports: [],
  reviewRequests: [],
})
