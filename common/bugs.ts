import { Jsonify } from './json'
import { SbUser } from './users/sb-user'
import { SbUserId } from './users/sb-user-id'

/** The longest app version string a bug report will store. */
export const MAX_BUG_REPORT_APP_VERSION_LENGTH = 32

export interface ReportBugRequest {
  details: string
  /** The version of the client the report was filed from. */
  appVersion?: string
}

export interface ReportBugResponse {}

export interface BugReport {
  id: string
  submitterId?: SbUserId
  details: string
  logsDeleted: boolean
  createdAt: Date
  resolvedAt?: Date
  resolverId?: SbUserId
  appVersion?: string
}

export type BugReportJson = Jsonify<BugReport>

export function toBugReportJson(report: BugReport): BugReportJson {
  return {
    id: report.id,
    submitterId: report.submitterId,
    details: report.details,
    logsDeleted: report.logsDeleted,
    createdAt: Number(report.createdAt),
    resolvedAt: report.resolvedAt ? Number(report.resolvedAt) : undefined,
    resolverId: report.resolverId,
    appVersion: report.appVersion,
  }
}

export const DEFAULT_BUG_REPORTS_PAGE_SIZE = 50
export const MAX_BUG_REPORTS_PAGE_SIZE = 100
/** The longest search string the bug report list accepts. */
export const MAX_BUG_REPORT_SEARCH_LENGTH = 200

export interface ListBugReportsRequest {
  includeResolved?: boolean
  /**
   * Matches reports whose ID or details contain this text, whose submitter's name contains it, or
   * (if it is all digits) whose submitter has this user ID. Case-insensitive.
   */
  search?: string
  /** Only include reports filed from exactly this app version. */
  appVersion?: string
  /** The ID of the last report of the previous page; the page starts with the report after it. */
  before?: string
  limit?: number
}

export interface ListBugReportsResponseJson {
  /** Matching reports, newest first. */
  reports: BugReportJson[]
  users: SbUser[]
  /** Whether more matching reports exist after the last one in `reports`. */
  hasMore: boolean
  /** Every app version any bug report was filed from, newest first. */
  appVersions: string[]
}

export interface GetBugReportResponseJson {
  report: BugReportJson
  users: SbUser[]
  logsUrl?: string
}

/**
 * Orders app versions newest first, comparing each dot-separated component numerically (so 12.10.0
 * sorts above 12.9.0). A component that isn't a plain number compares as text after the numeric
 * part, and a version that runs out of components sorts below one that continues (12.4.1 above
 * 12.4).
 */
export function compareAppVersionsNewestFirst(a: string, b: string): number {
  const aParts = a.split('.')
  const bParts = b.split('.')
  const length = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < length; i++) {
    if (i >= aParts.length) {
      return 1
    } else if (i >= bParts.length) {
      return -1
    }

    const diff = compareVersionComponents(aParts[i], bParts[i])
    if (diff !== 0) {
      return -diff
    }
  }

  return 0
}

const LEADING_NUMBER = /^(\d*)(.*)$/

/** Compares two version components oldest first: their leading digits numerically, then the rest. */
function compareVersionComponents(a: string, b: string): number {
  const [, aDigits, aRest] = LEADING_NUMBER.exec(a)!
  const [, bDigits, bRest] = LEADING_NUMBER.exec(b)!
  const aNumber = aDigits ? Number(aDigits) : -1
  const bNumber = bDigits ? Number(bDigits) : -1
  if (aNumber !== bNumber) {
    return aNumber - bNumber
  }
  if (aRest === bRest) {
    return 0
  }
  // A bare number is a release, which sorts above a suffixed build of the same number (1-beta)
  if (!aRest) {
    return 1
  } else if (!bRest) {
    return -1
  }
  return aRest < bRest ? -1 : 1
}
