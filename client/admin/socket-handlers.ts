import type { NydusClient, RouteInfo } from 'nydus-client'
import { AdminReportCountsEvent, adminReportCountsPath } from '../../common/admin-report-counts'
import { jotaiStore } from '../jotai-store'
import { adminReportTimesAtom } from './admin-report-counts-atoms'

function handleReportCounts(_route: RouteInfo, event: AdminReportCountsEvent) {
  jotaiStore.set(adminReportTimesAtom, times => ({ ...times, [event.kind]: event.createdAt }))
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute(adminReportCountsPath('bugReports'), handleReportCounts)
  siteSocket.registerRoute(adminReportCountsPath('gameReports'), handleReportCounts)
  siteSocket.registerRoute(adminReportCountsPath('reviewRequests'), handleReportCounts)
}
