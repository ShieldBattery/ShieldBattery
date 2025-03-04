import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import { BugReportJson, GetBugReportResponseJson } from '../../common/bugs'
import { urlPath } from '../../common/urls'
import { NarrowDuration, longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaisedButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { push } from '../navigation/routing'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { usePrevious, useStableCallback } from '../state-hooks'
import { colorError } from '../styles/colors'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyLarge, titleLarge, titleMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { adminGetBugReport, adminListBugReports, adminResolveBugReport } from './action-creators'

const Content = styled.div`
  max-width: 960px;
  margin: 0 16px;
  overflow-y: auto;
`

const PageHeadline = styled.div`
  ${titleLarge};
`

const HeadlineAndButton = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 8px;
`

const ButtonWithCheckBox = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: ${colorError};
`

const ReportTable = styled.div`
  width: 100%;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 2px;
`

const TableRow = styled.div`
  height: 36px;

  display: flex;
  align-items: center;

  cursor: pointer;

  &:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }
`

const TableHeader = styled(TableRow)`
  cursor: default;
  font-weight: 500;
`

const TableCell = styled.div`
  height: 100%;
  padding: 8px 16px;

  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const NumericCell = styled(TableCell)`
  text-align: right;
  display: flex;
  justify-content: flex-end;
`

const DateCell = styled(NumericCell)`
  width: 112px;
  flex-grow: 0;
  flex-shrink: 0;
`

const SubmitterCell = styled(TableCell)`
  width: 128px;
  flex-grow: 0;
  flex-shrink: 0;
`

const DetailsCell = styled(TableCell)`
  flex-grow: 1;
`

const ResolvedCell = styled(NumericCell)`
  width: 96px;
  flex-grow: 0;
  flex-shrink: 0;
`

export function AdminBugReports() {
  return (
    <Switch>
      <Route path='/admin/bug-reports/:reportId' component={AdminBugReportView} />
      <Route component={AdminBugReportsList} />
    </Switch>
  )
}

function AdminBugReportsList() {
  const dispatch = useAppDispatch()
  const [refreshToken, triggerRefresh] = useRefreshToken()
  const [includeResolved, setIncludeResolved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bugReports, setBugReports] = useState<BugReportJson[]>()
  const [error, setError] = useState<Error>()

  useEffect(() => {
    setLoading(true)
    setError(undefined)
    dispatch(
      adminListBugReports(includeResolved, {
        onSuccess: response => {
          setLoading(false)
          setBugReports(response.reports)
        },
        onError: err => {
          setLoading(false)
          setError(err)
        },
      }),
    )
  }, [dispatch, refreshToken, includeResolved])

  return (
    <Content>
      <HeadlineAndButton>
        <PageHeadline>Bug reports</PageHeadline>
        {loading ? <LoadingDotsArea /> : null}
        <ButtonWithCheckBox>
          <CheckBox
            label='Include resolved'
            checked={includeResolved}
            onChange={() => setIncludeResolved(!includeResolved)}
          />
          <RaisedButton color='primary' label='Refresh' onClick={triggerRefresh} />
        </ButtonWithCheckBox>
      </HeadlineAndButton>
      {error ? <ErrorText>Error: ${error.message}</ErrorText> : null}
      <ReportTable>
        <TableHeader>
          <DateCell>Date</DateCell>
          <SubmitterCell>Submitter</SubmitterCell>
          <DetailsCell>Details</DetailsCell>
          <ResolvedCell>Resolved</ResolvedCell>
        </TableHeader>
        {(bugReports ?? []).map(r => (
          <BugReportRow report={r} key={r.id} />
        ))}
      </ReportTable>
    </Content>
  )
}

function BugReportRow({ report }: { report: BugReportJson }) {
  return (
    <TableRow onClick={() => push(urlPath`/admin/bug-reports/${report.id}`)}>
      <DateCell>
        <NarrowDuration to={report.createdAt} />
      </DateCell>
      <SubmitterCell>
        {report.submitterId ? <ConnectedUsername userId={report.submitterId} /> : 'Unknown user'}
      </SubmitterCell>
      <DetailsCell>{report.details}</DetailsCell>
      <ResolvedCell>{report.resolvedAt ? <MaterialIcon icon='check' /> : null}</ResolvedCell>
    </TableRow>
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
`

const DetailsValue = styled.pre`
  ${bodyLarge};

  margin: 0;
  padding: 8px 0 8px 8px;

  border-left: 1px solid var(--theme-outline-variant);
  font-family: inherit;
  white-space: pre-line;
`

function AdminBugReportView({ params: { reportId } }: { params: { reportId: string } }) {
  const dispatch = useAppDispatch()
  const [refreshToken, triggerRefresh] = useRefreshToken()
  const [loading, setLoading] = useState(false)
  const [bugReport, setBugReport] = useState<GetBugReportResponseJson>()
  const [error, setError] = useState<Error>()
  const abortControllerRef = useRef<AbortController>()

  const onResolveClick = useStableCallback(() => {
    setLoading(true)
    setError(undefined)
    dispatch(
      adminResolveBugReport(reportId, {
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
  })

  const prevReportId = usePrevious(reportId)
  useEffect(() => {
    if (reportId !== prevReportId) {
      setBugReport(undefined)
    }
  }, [reportId, prevReportId])

  useEffect(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    setLoading(true)
    setError(undefined)
    dispatch(
      adminGetBugReport(reportId, {
        signal: abortControllerRef.current?.signal,
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

  return (
    <Content>
      <HeadlineAndButton>
        <PageHeadline>Bug report</PageHeadline>
        {loading ? <LoadingDotsArea /> : null}
        <RaisedButton color='primary' label='Refresh' onClick={triggerRefresh} />
      </HeadlineAndButton>
      {error ? <ErrorText>Error: ${error.message}</ErrorText> : null}
      {bugReport ? (
        <Items>
          <Item>
            <ItemLabel>ID:</ItemLabel>
            <ItemValue>{bugReport?.report.id}</ItemValue>
          </Item>
          <Item>
            <ItemLabel>Submitter:</ItemLabel>
            <ItemValue>
              {bugReport.report.submitterId ? (
                <ConnectedUsername userId={bugReport.report.submitterId} />
              ) : (
                'Unknown user'
              )}
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>Submitted at:</ItemLabel>
            <ItemValue>{longTimestamp.format(bugReport.report.createdAt)}</ItemValue>
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
            <DetailsValue>{bugReport.report.details}</DetailsValue>
          </Item>
          {bugReport.report.resolvedAt ? (
            <>
              <Item>
                <ItemLabel>Resolved at:</ItemLabel>
                <ItemValue>{longTimestamp.format(bugReport.report.resolvedAt)}</ItemValue>
              </Item>
              <Item>
                <ItemLabel>Resolved by:</ItemLabel>
                <ItemValue>
                  {bugReport.report.resolverId ? (
                    <ConnectedUsername userId={bugReport.report.resolverId} />
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
                <RaisedButton label='Mark resolved' onClick={onResolveClick} />
              </ItemValue>
            </Item>
          )}
        </Items>
      ) : null}
    </Content>
  )
}
