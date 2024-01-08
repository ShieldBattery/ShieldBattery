import { Jsonify } from './json'
import { SbUser, SbUserId } from './users/sb-user'

export interface ReportBugRequest {
  details: string
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
  }
}

export interface ListBugReportsResponseJson {
  reports: BugReportJson[]
  users: SbUser[]
}

export interface GetBugReportResponseJson {
  report: BugReportJson
  users: SbUser[]
  logsUrl?: string
}
