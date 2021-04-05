import queryString from 'query-string'
import React, { useEffect, useState } from 'react'
import styled, { css } from 'styled-components'
import { Link } from 'wouter'
import { LogEntry } from '../../common/admin/server-logs'
import Card from '../material/card'
import RaisedButton from '../material/raised-button'
import { fetchJson } from '../network/fetch'
import { useRefreshToken } from '../network/refresh-token'
import { apiUrl, urlPath } from '../network/urls'
import { useAppDispatch } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { amberA200, blue200, colorError, colorTextSecondary, grey700 } from '../styles/colors'
import { headline5, overline, singleLine, subtitle1 } from '../styles/typography'

const timestampFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'numeric',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

const Container = styled.div`
  height: 100%;
  padding: 0 16px;
  border-left: var(--pixel-shove-x, 0) solid transparent;

  overflow-x: hidden;
  overflow-y: auto;
`

const FilterLinks = styled.div`
  display: flex;

  span,
  a {
    ${subtitle1};
  }

  a {
    margin-left: 16px;
  }
`

const PageHeadline = styled.div`
  ${headline5};
  margin-top: 16px;
  margin-bottom: 8px;
`

const HeadlineAndButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 8px;
`

const LogEntriesCard = styled(Card)`
  width: 100%;
  max-width: 1000px;
  margin: 8px auto;
`

const LogEntriesTable = styled.table`
  th {
    ${overline};
    color: ${colorTextSecondary};
    padding-left: 4px;
    padding-right: 4px;
  }
`

const LogEntryRow = styled.tr<{ $even?: boolean }>`
  padding: 8px 0;
  user-select: contain;

  & * {
    user-select: text;
  }

  ${props => {
    if (props.$even) {
      return css`
        background-color: ${grey700};
      `
    }

    return ''
  }}
`

const LevelCell = styled.td`
  width: 64px;
  padding: 4px;
  text-align: center;
  vertical-align: top;
`

const TimeCell = styled.td`
  width: 164px;
  padding: 4px;
  padding-right: 12px;
  color: ${colorTextSecondary};
  text-align: right;
  vertical-align: top;
`

const DataCell = styled.td`
  padding: 4px;
  text-align: left;
  vertical-align: top;
`

const DataMessage = styled.div`
  margin: 0 4px;
`

const DataExtras = styled.div`
  width: 100%;
  margin-top: 8px;
  margin-bottom: 8px;

  display: flex;
  flex-wrap: wrap;
`

const DataExtra = styled.div<{ $borderColor: string }>`
  max-width: 640px;
  border: 1px solid ${props => props.$borderColor};
  border-radius: 2px;
  margin: 4px;
  padding: 4px 8px;
`

const DataExtraItemContainer = styled.div`
  display: flex;
  align-items: baseline;
`

const DataExtraItemLabel = styled.div`
  ${overline};
  width: 72px;
  flex-shrink: 0;

  color: ${colorTextSecondary};
  line-height: 24px;
  text-align: right;
`

const DataExtraItemValue = styled.div`
  ${singleLine};
  flex-grow: 1;
  margin-left: 8px;
  line-height: 24px;
`

function DataExtraItem({ label, value }: { label: string; value: string }) {
  return (
    <DataExtraItemContainer>
      <DataExtraItemLabel>{label}</DataExtraItemLabel>
      <DataExtraItemValue title={value}>{value}</DataExtraItemValue>
    </DataExtraItemContainer>
  )
}

function LevelText({ level }: { level: number }) {
  // TODO(tec27): Color these or something
  switch (level) {
    case 60:
      return <span>Fatal</span>
    case 50:
      return <span>Error</span>
    case 40:
      return <span>Warn</span>
    case 30:
      return <span>Info</span>
    case 20:
      return <span>Debug</span>
    case 10:
      return <span>Trace</span>
    default:
      return <span>{level}</span>
  }
}

function LogEntryRequest({ req }: { req: NonNullable<LogEntry['data']['req']> }) {
  // TODO(tec27): print useful headers
  return (
    <DataExtra $borderColor={blue200}>
      <DataExtraItem label='id' value={req.id} />
      <DataExtraItem label='request' value={`${req.method} ${req.url}`} />
    </DataExtra>
  )
}

function LogEntryResponse({
  res,
  responseTime,
}: {
  res: NonNullable<LogEntry['data']['res']>
  responseTime?: number
}) {
  return (
    <DataExtra $borderColor={amberA200}>
      <DataExtraItem label='statusCode' value={String(res.statusCode)} />
      {responseTime !== undefined ? (
        <DataExtraItem label='time' value={`${responseTime}ms`} />
      ) : null}
    </DataExtra>
  )
}

function LogEntryError({ err }: { err: NonNullable<LogEntry['data']['err']> }) {
  return (
    <DataExtra $borderColor={colorError}>
      <DataExtraItem label='type' value={err.type} />
      <DataExtraItem label='message' value={err.message ?? ''} />
      {err.stack ? <pre>{err.stack}</pre> : null}
    </DataExtra>
  )
}

const LogEntryUi = React.memo(function LogEntry({
  entry: { data },
  even,
}: {
  entry: LogEntry
  even: boolean
}) {
  const hasExtras = !!(data.req || data.res || data.err)

  return (
    <LogEntryRow $even={even}>
      <LevelCell>
        <LevelText level={data.level} />
      </LevelCell>
      <TimeCell>{timestampFormat.format(data.time)}</TimeCell>
      <DataCell>
        <DataMessage>{data.msg}</DataMessage>
        {hasExtras ? (
          <DataExtras>
            {data.req ? <LogEntryRequest req={data.req} /> : null}
            {data.res ? <LogEntryResponse res={data.res} responseTime={data.responseTime} /> : null}
            {data.err ? <LogEntryError err={data.err} /> : null}
          </DataExtras>
        ) : null}
      </DataCell>
    </LogEntryRow>
  )
})

export function DebugLogs() {
  const dispatch = useAppDispatch()
  const [refreshToken, triggerRefresh] = useRefreshToken()
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])

  const { level } = queryString.parse(location.search)

  useEffect(() => {
    const levelQuery = typeof level === 'string' ? urlPath`level=${level}` : ''
    const query = [levelQuery].filter(s => !!s).join('&')

    fetchJson<{ entries: LogEntry[] }>(apiUrl`admin/logs/?` + query)
      .then(data => setLogEntries(data.entries))
      .catch(err => {
        dispatch(openSnackbar({ message: 'Error retrieving logs' }))
        console.error(err)
      })
  }, [refreshToken, level])

  return (
    <Container>
      <HeadlineAndButton>
        <PageHeadline>Server logs</PageHeadline>

        <FilterLinks>
          <span>Show: </span>
          <Link href='?'>All</Link>
          <Link href='?level=50'>Errors</Link>
        </FilterLinks>

        <RaisedButton label='Refresh' color='primary' onClick={triggerRefresh} />
      </HeadlineAndButton>
      <LogEntriesCard>
        <LogEntriesTable>
          <thead>
            <LogEntryRow>
              <th>Level</th>
              <th>Time</th>
              <th>Message</th>
            </LogEntryRow>
          </thead>
          <tbody>
            {logEntries.map((entry, i) => (
              <LogEntryUi entry={entry} key={entry.id} even={i % 2 === 0} />
            ))}
          </tbody>
        </LogEntriesTable>
      </LogEntriesCard>
    </Container>
  )
}
