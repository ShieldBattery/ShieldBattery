import { debounce } from 'lodash-es'
import { ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import { Link, Route, Switch, useSearch } from 'wouter'
import {
  BugReportJson,
  DEFAULT_BUG_REPORTS_PAGE_SIZE,
  GetBugReportResponseJson,
  MAX_BUG_REPORT_SEARCH_LENGTH,
} from '../../common/bugs'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { longTimestamp, longTimestampWithSeconds, narrowDuration } from '../i18n/date-formats'
import { useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { push, replace } from '../navigation/routing'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingDotsArea } from '../progress/dots'
import { useNow } from '../react/date-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { SearchInput } from '../search/search-input'
import { selectableTextContainer } from '../styles/text-selection'
import {
  bodyLarge,
  bodyMedium,
  labelMedium,
  singleLine,
  titleLarge,
  titleMedium,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { adminGetBugReport, adminListBugReports, adminResolveBugReport } from './action-creators'

/** The number of leading UUID characters people use to refer to a report. */
const SHORT_ID_LENGTH = 8

const SEARCH_DEBOUNCE_MS = 300

const SEARCH_PARAM = 'search'
const VERSION_PARAM = 'version'
const RESOLVED_PARAM = 'resolved'

/**
 * The query string of the list page as it was last shown, so the detail page can link back to the
 * same filtered list.
 */
let lastListQuery = ''

/**
 * Report IDs and versions are read and compared character by character, so they're set in a
 * monospace face that keeps them aligned from row to row.
 */
const monospace = css`
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
`

const Content = styled.div`
  max-width: 1280px;
  margin: 0 16px;
  padding-bottom: 24px;
`

const PageHeadline = styled.div`
  ${titleLarge};
`

const HeadlineAndButton = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
  margin-bottom: 8px;
`

const HeadlineSpacer = styled.div`
  flex-grow: 1;
`

const FilterBar = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
`

const StyledSearchInput = styled(SearchInput)`
  flex: 0 1 400px;
`

const VersionSelect = styled(Select)`
  flex: 0 0 200px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const ErrorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
`

const EmptyText = styled.div`
  ${bodyLarge};
  padding: 32px 16px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const REPORT_COLUMNS = '96px 248px 168px 96px minmax(0, 1fr) 88px'

const ReportTable = styled.div<{ $stale: boolean }>`
  width: 100%;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;

  opacity: ${props => (props.$stale ? 0.56 : 1)};
  transition: opacity 150ms linear;
`

const rowLayout = css`
  height: 40px;
  padding: 0 8px;

  display: grid;
  grid-template-columns: ${REPORT_COLUMNS};
  align-items: center;
`

const TableHeader = styled.div`
  ${rowLayout};
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  border-bottom: 1px solid var(--theme-outline-variant);
`

const ReportRow = styled(Link)<{ $resolved: boolean }>`
  ${rowLayout};
  ${bodyMedium};

  /* Doubled to win over the global link colors and hover underline */
  && {
    color: ${props =>
      props.$resolved ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'};
    text-decoration: none;
  }

  &:nth-of-type(even) {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &:hover,
  &:focus-visible {
    background-color: rgba(255, 255, 255, 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }
`

const Cell = styled.div`
  ${singleLine};
  min-width: 0;
  padding: 0 8px;
`

const ShortIdCell = styled(Cell)`
  ${monospace};
  color: var(--theme-primary);
`

const MutedText = styled.span`
  color: var(--theme-on-surface-variant);
`

const VersionCell = styled(Cell)`
  ${monospace};
`

const RightAlignedCell = styled(Cell)`
  text-align: right;
`

const ResolvedCell = styled(Cell)`
  display: flex;
  justify-content: flex-end;
  color: var(--theme-positive);
`

export function AdminBugReports() {
  return (
    <Switch>
      <Route path='/admin/bug-reports/:reportId' component={AdminBugReportView} />
      <Route component={AdminBugReportsList} />
    </Switch>
  )
}

interface BugReportListFilters {
  search: string
  appVersion: string
  includeResolved: boolean
}

function filtersFromQuery(query: string): BugReportListFilters {
  const params = new URLSearchParams(query)
  return {
    search: params.get(SEARCH_PARAM) ?? '',
    appVersion: params.get(VERSION_PARAM) ?? '',
    includeResolved: params.get(RESOLVED_PARAM) === 'true',
  }
}

/**
 * Writes filter changes into the current URL's query string, replacing the history entry so the
 * list (and going back to it from a report) keeps them without each keystroke adding an entry.
 */
function updateFiltersInUrl(changes: Partial<BugReportListFilters>) {
  const params = new URLSearchParams(location.search)
  const setOrDelete = (name: string, value: string | undefined) => {
    if (value) {
      params.set(name, value)
    } else {
      params.delete(name)
    }
  }
  if (changes.search !== undefined) {
    setOrDelete(SEARCH_PARAM, changes.search)
  }
  if (changes.appVersion !== undefined) {
    setOrDelete(VERSION_PARAM, changes.appVersion)
  }
  if (changes.includeResolved !== undefined) {
    setOrDelete(RESOLVED_PARAM, changes.includeResolved ? 'true' : undefined)
  }
  replace({ pathname: location.pathname, search: params.toString() })
}

function shortId(reportId: string) {
  return reportId.slice(0, SHORT_ID_LENGTH)
}

/** Formats a timestamp as `YYYY-MM-DD HH:MM:SS UTC`. */
function formatUtc(time: number) {
  return new Date(time).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
}

function AdminBugReportsList() {
  const dispatch = useAppDispatch()
  const query = useSearch()
  const { search: rawSearch, appVersion, includeResolved } = filtersFromQuery(query)
  // The server ignores surrounding whitespace, so it doesn't make for a different list
  const search = rawSearch.trim().slice(0, MAX_BUG_REPORT_SEARCH_LENGTH)
  const hasFilters = !!search || !!appVersion

  const [refreshToken, triggerRefresh] = useRefreshToken()
  const [reports, setReports] = useState<BugReportJson[]>()
  const [hasMore, setHasMore] = useState(false)
  const [appVersions, setAppVersions] = useState<string[]>([])
  const [loadingPage, setLoadingPage] = useState<'first' | 'next'>()
  const [error, setError] = useState<Error>()
  const [nextPageError, setNextPageError] = useState<Error>()
  const abortRef = useRef(new AbortController())
  const [debouncedSearchChange] = useState(() =>
    debounce((value: string) => updateFiltersInUrl({ search: value }), SEARCH_DEBOUNCE_MS),
  )

  const load = (before: string | undefined) => {
    abortRef.current.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    dispatch(
      adminListBugReports(
        {
          includeResolved,
          search,
          appVersion,
          before,
          limit: DEFAULT_BUG_REPORTS_PAGE_SIZE,
        },
        {
          signal: abortController.signal,
          onStart: () => {
            setLoadingPage(before ? 'next' : 'first')
            setNextPageError(undefined)
            if (!before) {
              setError(undefined)
            }
          },
          onSuccess: response => {
            setLoadingPage(undefined)
            setReports(prev => (before ? (prev ?? []).concat(response.reports) : response.reports))
            setHasMore(response.hasMore)
            setAppVersions(response.appVersions)
          },
          onError: err => {
            setLoadingPage(undefined)
            if (before) {
              setNextPageError(err)
            } else {
              setReports(undefined)
              setError(err)
            }
          },
        },
      ),
    )
  }

  const loadFirstPage = useEffectEvent(() => load(undefined))

  useEffect(() => {
    loadFirstPage()
  }, [includeResolved, search, appVersion, refreshToken])

  useEffect(() => {
    lastListQuery = query
  }, [query])

  useEffect(() => {
    return () => {
      abortRef.current.abort()
      debouncedSearchChange.cancel()
    }
  }, [debouncedSearchChange])

  const now = useNow(60_000)
  const lastReport = reports?.at(-1)
  const versionOptions =
    appVersion && !appVersions.includes(appVersion) ? [appVersion, ...appVersions] : appVersions

  let body: ReactNode
  if (reports === undefined) {
    body = error ? (
      <ErrorRow>
        <ErrorText>Couldn't load bug reports: {error.message}</ErrorText>
        <OutlinedButton label='Retry' onClick={triggerRefresh} />
      </ErrorRow>
    ) : (
      <LoadingDotsArea />
    )
  } else if (!reports.length) {
    let emptyText = 'No bug reports.'
    if (hasFilters) {
      emptyText = 'No bug reports match these filters.'
    } else if (!includeResolved) {
      emptyText = 'No unresolved bug reports.'
    }
    body = <EmptyText>{emptyText}</EmptyText>
  } else {
    body = (
      <InfiniteScrollList
        nextLoadingEnabled={loadingPage !== 'first'}
        isLoadingNext={loadingPage === 'next'}
        hasNextData={hasMore}
        refreshToken={`${includeResolved}|${search}|${appVersion}|${refreshToken}`}
        nextError={
          nextPageError ? (
            <ErrorRow>
              <ErrorText>Couldn't load more reports: {nextPageError.message}</ErrorText>
              <OutlinedButton label='Retry' onClick={() => load(lastReport?.id)} />
            </ErrorRow>
          ) : undefined
        }
        onLoadNextData={() => load(lastReport?.id)}>
        {reports.map(r => (
          <BugReportRow key={r.id} report={r} now={now} />
        ))}
      </InfiniteScrollList>
    )
  }

  return (
    <Content>
      <HeadlineAndButton>
        <PageHeadline>Bug reports</PageHeadline>
        {loadingPage ? <LoadingDotsArea /> : null}
        <HeadlineSpacer />
        <FilledButton label='Refresh' iconStart='refresh' onClick={triggerRefresh} />
      </HeadlineAndButton>
      <FilterBar>
        <StyledSearchInput
          label='Search ID, user or details'
          searchQuery={rawSearch}
          onSearchChange={debouncedSearchChange}
        />
        <VersionSelect
          label='Version'
          value={appVersion}
          dense={true}
          allowErrors={false}
          onChange={(value: string) => updateFiltersInUrl({ appVersion: value })}>
          <SelectOption value='' text='All versions' />
          {versionOptions.map(v => (
            <SelectOption key={v} value={v} text={v} />
          ))}
        </VersionSelect>
        <CheckBox
          label='Include resolved'
          checked={includeResolved}
          onChange={() => updateFiltersInUrl({ includeResolved: !includeResolved })}
        />
      </FilterBar>
      <ReportTable $stale={loadingPage === 'first' && !!reports?.length}>
        <TableHeader>
          <Cell>ID</Cell>
          <Cell>Submitted</Cell>
          <Cell>Submitter</Cell>
          <Cell>Version</Cell>
          <Cell>Details</Cell>
          <RightAlignedCell>Resolved</RightAlignedCell>
        </TableHeader>
        {body}
      </ReportTable>
    </Content>
  )
}

function SubmitterName({ userId }: { userId: SbUserId | undefined }) {
  const name = useAppSelector(s => (userId ? s.users.byId.get(userId)?.name : undefined))
  if (!userId) {
    return <MutedText>Unknown user</MutedText>
  }
  return name ?? <MutedText>#{userId}</MutedText>
}

function BugReportRow({ report, now }: { report: BugReportJson; now: number }) {
  const longTimestampFormat = useFormat(longTimestamp)
  const narrowDurationFormat = useFormat(narrowDuration)

  return (
    <ReportRow href={urlPath`/admin/bug-reports/${report.id}`} $resolved={!!report.resolvedAt}>
      <ShortIdCell title={report.id}>{shortId(report.id)}</ShortIdCell>
      <Cell title={formatUtc(report.createdAt)}>
        {longTimestampFormat.format(report.createdAt)}{' '}
        <MutedText>· {narrowDurationFormat.format(report.createdAt, now)}</MutedText>
      </Cell>
      <Cell>
        <SubmitterName userId={report.submitterId} />
      </Cell>
      <VersionCell>{report.appVersion ?? <MutedText>Unknown</MutedText>}</VersionCell>
      <Cell title={report.details}>{report.details}</Cell>
      <ResolvedCell title={report.resolvedAt ? 'Resolved' : undefined}>
        {report.resolvedAt ? <MaterialIcon icon='check' size={20} /> : null}
      </ResolvedCell>
    </ReportRow>
  )
}

const Items = styled.div`
  ${selectableTextContainer};
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Item = styled.div`
  justify-content: flex-start;
  display: flex;
  gap: 16px;
`

const ItemLabel = styled.div`
  ${titleMedium};
  width: 128px;
  flex: 0 0 auto;
  text-align: right;
`

const ItemValue = styled.div`
  ${bodyLarge};
  min-width: 0;
  overflow-wrap: anywhere;
`

const MonospaceValue = styled(ItemValue)`
  ${monospace};
`

const ShortIdPart = styled.span`
  color: var(--theme-primary);
  font-weight: 600;
`

const SecondaryValue = styled.span`
  color: var(--theme-on-surface-variant);
`

const DetailsValue = styled.pre`
  ${bodyLarge};

  margin: 0;
  padding: 8px 0 8px 8px;

  border-left: 1px solid var(--theme-outline-variant);
  font-family: inherit;
  overflow-wrap: anywhere;
  white-space: pre-line;
`

function AdminBugReportView({ params: { reportId } }: { params: { reportId: string } }) {
  const dispatch = useAppDispatch()
  const longTimestampFormat = useFormat(longTimestampWithSeconds)
  const [refreshToken, triggerRefresh] = useRefreshToken()
  const [loading, setLoading] = useState(false)
  const [bugReport, setBugReport] = useState<GetBugReportResponseJson>()
  const [error, setError] = useState<Error>()
  const abortControllerRef = useRef<AbortController>(undefined)

  const onResolveClick = () => {
    dispatch(
      adminResolveBugReport(reportId, {
        onStart: () => {
          setLoading(true)
          setError(undefined)
        },
        onSuccess: () => {
          setLoading(false)
          triggerRefresh()
        },
        onError: err => {
          setLoading(false)
          setError(err)
        },
      }),
    )
  }

  useEffect(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      adminGetBugReport(reportId, {
        signal: abortControllerRef.current?.signal,
        onStart: () => {
          setLoading(true)
          setError(undefined)
        },
        onSuccess: response => {
          setLoading(false)
          setBugReport(response)
        },
        onError: err => {
          setLoading(false)
          setError(err)
        },
      }),
    )
  }, [dispatch, refreshToken, reportId])

  const report = bugReport?.report

  return (
    <Content>
      <HeadlineAndButton>
        <TextButton
          label='All bug reports'
          iconStart='arrow_back'
          onClick={() => push({ pathname: '/admin/bug-reports', search: lastListQuery })}
        />
        <PageHeadline>Bug report {shortId(reportId)}</PageHeadline>
        {loading ? <LoadingDotsArea /> : null}
        <HeadlineSpacer />
        <FilledButton label='Refresh' iconStart='refresh' onClick={triggerRefresh} />
      </HeadlineAndButton>
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {report && bugReport ? (
        <Items>
          <Item>
            <ItemLabel>ID:</ItemLabel>
            <MonospaceValue>
              <ShortIdPart>{shortId(report.id)}</ShortIdPart>
              {report.id.slice(SHORT_ID_LENGTH)}
            </MonospaceValue>
          </Item>
          <Item>
            <ItemLabel>Submitter:</ItemLabel>
            <ItemValue>
              {report.submitterId ? (
                <>
                  <ConnectedUsername userId={report.submitterId} />{' '}
                  <SecondaryValue>(user ID {report.submitterId})</SecondaryValue>
                </>
              ) : (
                'Unknown user'
              )}
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>Submitted at:</ItemLabel>
            <ItemValue>
              {longTimestampFormat.format(report.createdAt)}{' '}
              <SecondaryValue>({formatUtc(report.createdAt)})</SecondaryValue>
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>App version:</ItemLabel>
            <ItemValue>
              {report.appVersion ?? <SecondaryValue>Not recorded</SecondaryValue>}
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>Log files:</ItemLabel>
            <ItemValue>
              {bugReport.logsUrl ? (
                <a href={bugReport.logsUrl} target='_blank' rel='noopener'>
                  Download
                </a>
              ) : (
                'Files have been deleted.'
              )}
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>Details:</ItemLabel>
            <DetailsValue>{report.details}</DetailsValue>
          </Item>
          {report.resolvedAt ? (
            <>
              <Item>
                <ItemLabel>Resolved at:</ItemLabel>
                <ItemValue>{longTimestampFormat.format(report.resolvedAt)}</ItemValue>
              </Item>
              <Item>
                <ItemLabel>Resolved by:</ItemLabel>
                <ItemValue>
                  {report.resolverId ? (
                    <ConnectedUsername userId={report.resolverId} />
                  ) : (
                    'Unknown user'
                  )}
                </ItemValue>
              </Item>
            </>
          ) : (
            <Item>
              <ItemLabel></ItemLabel>
              <ItemValue>
                <FilledButton label='Mark resolved' onClick={onResolveClick} />
              </ItemValue>
            </Item>
          )}
        </Items>
      ) : null}
    </Content>
  )
}
