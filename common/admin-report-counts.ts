/**
 * How far back an unresolved report still counts toward the admin report counts. Reports older
 * than this are left out even if they're still unresolved, so a report that is left open on purpose
 * doesn't keep the count lit forever.
 */
export const ADMIN_REPORT_COUNT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The most report timestamps sent for a single kind. Counts at or above this are shown as a
 * capped value.
 */
export const ADMIN_REPORT_COUNT_MAX = 100

export type AdminReportKind = 'bugReports' | 'gameReports' | 'reviewRequests'

/**
 * Sent (as initial subscription data and on every change) to admins holding the permission for
 * `kind`. Carries the creation time of each unresolved report within the count window, newest
 * first, so the client can drop reports as they age out without waiting for another event.
 */
export interface AdminReportCountsEvent {
  kind: AdminReportKind
  createdAt: number[]
}

export function adminReportCountsPath(kind: AdminReportKind): string {
  switch (kind) {
    case 'bugReports':
      return '/admin-report-counts/bug-reports'
    case 'gameReports':
      return '/admin-report-counts/game-reports'
    case 'reviewRequests':
      return '/admin-report-counts/review-requests'
    default:
      return kind satisfies never
  }
}
