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
import { useDimensions } from '../dom/use-dimensions'
import fetchJson from '../network/fetch'
import { apiUrl } from '../network/urls'
import { useAppDispatch } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { colorDividers, colorTextFaint, grey850 } from '../styles/colors'
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
  backgroundColor: grey850,
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

export function DebugMatchmaking() {
  const [containerRef, containerRect] = useDimensions()
  const [data, setData] = useState<QueueSizeValue[]>([])
  const dispatch = useAppDispatch()

  const [startDate, endDate] = useMemo(() => {
    const startDate = new Date()
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
  }, [])

  useEffect(() => {
    fetchJson<QueueSizeHistoryResult>(
      apiUrl`matchmakingDebug/1v1/queueSize?startDate=${+startDate}&endDate=${+endDate}`,
    ).then(
      result => {
        setData(result.history)
      },
      err => {
        dispatch(openSnackbar({ message: 'Error retrieving queue size history' }))
        console.error(err)
      },
    )
  }, [startDate, endDate])

  return (
    <Container ref={containerRef}>
      <ChartHeadline>Queue Size</ChartHeadline>
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
          <LineSeries dataKey='Current week' curve={curveStep} data={data} {...accessors} />
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
