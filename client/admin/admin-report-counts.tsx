import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import styled from 'styled-components'
import {
  ADMIN_REPORT_COUNT_MAX,
  ADMIN_REPORT_COUNT_WINDOW_MS,
  AdminReportKind,
} from '../../common/admin-report-counts'
import { useSelfPermissions } from '../auth/auth-utils'
import { MaterialIcon } from '../icons/material/material-icon'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { push } from '../navigation/routing'
import { labelMedium } from '../styles/typography'
import { adminReportTimesAtom } from './admin-report-counts-atoms'

const CountButton = styled.button`
  ${buttonReset};
  ${labelMedium};

  height: 20px;
  padding: 0 8px 0 4px;

  display: flex;
  align-items: center;
  gap: 2px;

  background-color: var(--theme-amber-container);
  color: var(--theme-on-amber-container);
  border-radius: 10px;
  -webkit-app-region: no-drag;
`

/**
 * Returns how many of `times` fall within the count window, re-rendering when the oldest of them
 * ages out.
 */
function useCountInWindow(times: readonly number[]): number {
  const [now, setNow] = useState(() => Date.now())
  const cutoff = now - ADMIN_REPORT_COUNT_WINDOW_MS
  const inWindow = times.filter(t => t > cutoff)
  const nextExpiry = inWindow.length
    ? Math.min(...inWindow) + ADMIN_REPORT_COUNT_WINDOW_MS
    : undefined

  useEffect(() => {
    if (nextExpiry === undefined) {
      return undefined
    }
    const timeout = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 1)
    return () => clearTimeout(timeout)
  }, [nextExpiry])

  return inWindow.length
}

const KIND_INFO: Record<
  AdminReportKind,
  { icon: string; noun: [singular: string, plural: string]; url: string }
> = {
  bugReports: {
    icon: 'bug_report',
    noun: ['bug report', 'bug reports'],
    url: '/admin/bug-reports',
  },
  gameReports: {
    icon: 'flag',
    noun: ['game report', 'game reports'],
    url: '/admin/game-reports',
  },
}

function ReportCount({ kind, times }: { kind: AdminReportKind; times: readonly number[] }) {
  const count = useCountInWindow(times)
  const { icon, noun, url } = KIND_INFO[kind]
  const [buttonProps, rippleRef] = useButtonState({ onClick: () => push(url) })

  if (!count) {
    return null
  }

  const countText = count >= ADMIN_REPORT_COUNT_MAX ? `${ADMIN_REPORT_COUNT_MAX - 1}+` : `${count}`
  const title = `${countText} unresolved ${count === 1 ? noun[0] : noun[1]} in the last day`

  return (
    <CountButton type='button' title={title} aria-label={title} {...buttonProps}>
      <MaterialIcon icon={icon} size={16} filled={false} />
      <span>{countText}</span>
      <Ripple ref={rippleRef} />
    </CountButton>
  )
}

/**
 * Chips showing how many recent reports of each kind are still unresolved, for the report kinds
 * the current user can manage. Each one links to that kind's admin page.
 */
export function AdminReportCounts() {
  const permissions = useSelfPermissions()
  const times = useAtomValue(adminReportTimesAtom)

  return (
    <>
      {permissions?.manageBugReports ? (
        <ReportCount kind='bugReports' times={times.bugReports} />
      ) : null}
      {permissions?.manageGameReports ? (
        <ReportCount kind='gameReports' times={times.gameReports} />
      ) : null}
    </>
  )
}
