import { curveStep } from '@visx/curve'
import {
  Axis,
  buildChartTheme,
  darkTheme,
  DataContext,
  Grid,
  LineSeries,
  Tooltip,
  XYChart,
} from '@visx/xychart'
import { timeFormat } from 'd3-time-format'
import React, { useContext, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { apiUrl } from '../../common/urls'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { RaisedButton } from '../material/button'
import { fetchJson } from '../network/fetch'
import { useRefreshToken } from '../network/refresh-token'
import { useAppDispatch } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { background800, colorDividers, colorTextFaint } from '../styles/colors'
import { headline5 } from '../styles/typography'

const Container = styled.div`
  height: 100%;
  padding: 0 16px;

  overflow-y: auto;
`

const AspectRatio16x9 = styled.div`
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
`

interface QueueSizeValue {
  time: number
  size: number
}

interface QueueSizeHistoryResult {
  startDate: string
  endDate: string
  history: QueueSizeValue[]
}

const accessors = {
  xAccessor: (d?: QueueSizeValue) => d?.time,
  yAccessor: (d?: QueueSizeValue) => d?.size,
}

// TODO(tec27): Put this somewhere better/add it as a Context
const theme = buildChartTheme({
  ...darkTheme,
  backgroundColor: background800,
  htmlLabel: {
    color: '#ffffff',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 400,
    fontSize: '16px',
    letterSpacing: '0.15px',
    lineHeight: '24px',
    textRendering: 'optimizeLegibility',
    pointerEvents: 'none',
    textAnchor: 'middle',
  },
  svgLabelBig: {
    fill: '#ffffff',
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    fontWeight: 400,
    letterSpacing: '0.5px',
    lineHeight: '20px',
    pointerEvents: 'none',
    stroke: 'none',
    textAnchor: 'middle',
  },
  svgLabelSmall: {
    fill: '#ffffff',
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    fontWeight: 400,
    letterSpacing: '0.4px',
    lineHeight: '20px',
    pointerEvents: 'none',
    stroke: 'none',
    textAnchor: 'middle',
  },
  tickLength: 4,
  gridColor: colorTextFaint,
  gridColorDark: colorDividers,
})

const TIME_FORMAT = timeFormat('%a %H:%m')

function ChartBackground() {
  const { theme, width, height } = useContext(DataContext)

  return (
    <rect x={0} y={0} width={width} height={height} fill={theme?.backgroundColor ?? 'magenta'} />
  )
}

const ChartHeadline = styled.div`
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

/**
 * Retrieves the queue size history from the server. Can optionally pass a `refreshToken` to trigger
 * a re-request of the data.
 *
 * @param weeksBeforeCurrent the number of weeks prior to the current one to retrieve data for (e.g.
 *   0 for the current week, 1 for last week, etc.)
 * @param refreshToken A value that changes if a data refresh is needed
 */
function useQueueSizeHistory(
  weeksBeforeCurrent: number,
  refreshToken?: unknown,
): [data: QueueSizeValue[], startDate: Date, endDate: Date] {
  const dispatch = useAppDispatch()

  const [data, setData] = useState<QueueSizeValue[]>([])
  const [startDate, endDate] = useMemo(() => {
    const startDate = new Date()
    startDate.setUTCDate(startDate.getUTCDate() - 7 * weeksBeforeCurrent)
    const curDay = startDate.getUTCDay()
    if (curDay > 1) {
      // Past Monday, subtract days to get back there
      startDate.setUTCDate(startDate.getUTCDate() - (curDay - 1))
    } else if (curDay < 1) {
      // It's Sunday, so subtract 6 days to get to the previous Monday
      startDate.setUTCDate(startDate.getUTCDate() - 6)
    }

    startDate.setUTCHours(0, 0, 0, 0)

    const endDate = new Date(startDate.getTime())
    endDate.setUTCDate(endDate.getUTCDate() + 7)

    return [startDate, endDate]
  }, [weeksBeforeCurrent])

  useEffect(() => {
    fetchJson<QueueSizeHistoryResult>(
      apiUrl`matchmakingDebug/1v1/queueSize?startDate=${+startDate}&endDate=${+endDate}`,
    ).then(
      result => {
        // Adjust this data to fall within the bounds of the current week so that all weeks can
        // be graphed in the same domain
        const timeAdjustment = weeksBeforeCurrent * 7 * 24 * 60 * 60 * 1000
        const mappedHistory = result.history.map(d => ({
          time: d.time + timeAdjustment,
          size: d.size,
        }))
        setData(mappedHistory)
      },
      err => {
        dispatch(openSnackbar({ message: 'Error retrieving queue size history' }))
        console.error(err)
      },
    )
  }, [refreshToken, startDate, endDate, weeksBeforeCurrent, dispatch])

  return [data, startDate, endDate]
}

export function DebugMatchmaking() {
  const [containerRef, containerRect] = useObservedDimensions()
  const [refreshToken, triggerRefresh] = useRefreshToken()

  const [currentWeekData, startDate, endDate] = useQueueSizeHistory(0, refreshToken)
  const [lastWeekData] = useQueueSizeHistory(1, refreshToken)

  return (
    <Container ref={containerRef}>
      <HeadlineAndButton>
        <ChartHeadline>Queue Size</ChartHeadline>
        <RaisedButton label='Refresh' color='primary' onClick={triggerRefresh} />
      </HeadlineAndButton>
      <AspectRatio16x9>
        <XYChart
          width={containerRect?.width ?? 0}
          xScale={{ type: 'utc', domain: [startDate, endDate] }}
          yScale={{ type: 'linear' }}
          theme={theme}>
          <ChartBackground />
          <Axis orientation='left' />
          <Axis orientation='bottom' tickFormat={(v, i) => (i % 4 === 0 ? TIME_FORMAT(v) : '')} />
          <Grid columns={false} numTicks={4} />
          <LineSeries
            dataKey='Current week'
            curve={curveStep}
            data={currentWeekData}
            {...accessors}
          />
          <LineSeries dataKey='Last week' curve={curveStep} data={lastWeekData} {...accessors} />
          <Tooltip
            snapTooltipToDatumX={true}
            snapTooltipToDatumY={true}
            showVerticalCrosshair={true}
            showSeriesGlyphs={true}
            renderTooltip={({ tooltipData, colorScale }) => (
              <div>
                <div style={{ color: colorScale!(tooltipData!.nearestDatum!.key) }}>
                  {tooltipData?.nearestDatum?.key}
                </div>
                {TIME_FORMAT(
                  new Date(
                    accessors.xAccessor(tooltipData!.nearestDatum!.datum as QueueSizeValue) ?? 0,
                  ),
                )}
                {': '}
                {accessors.yAccessor(tooltipData!.nearestDatum!.datum as QueueSizeValue)}
              </div>
            )}
          />
        </XYChart>
      </AspectRatio16x9>
    </Container>
  )
}
