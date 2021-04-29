import { List } from 'immutable'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Column, Table, TableCellRenderer, TableHeaderProps } from 'react-virtualized'
import styled from 'styled-components'
import { LadderPlayer } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import Avatar from '../avatars/avatar'
import { useDimensions } from '../dom/use-dimensions'
import { AnimationFrameHandler, animationFrameHandler } from '../material/animation-frame-handler'
import { shadow4dp } from '../material/shadows'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { usePropAsRef } from '../state-hooks'
import {
  colorError,
  colorTextFaint,
  colorTextSecondary,
  grey800,
  grey850,
  grey900,
} from '../styles/colors'
import { overline, subtitle1, subtitle2 } from '../styles/typography'
import { timeAgo } from '../time/time-ago'
import { getRankings } from './action-creators'

const LadderPage = styled.div`
  width: 100%;
  height: 100%;
`

/**
 * Displays a ranked table of players on the ladder(s).
 */
export function Ladder() {
  // TODO(tec27): Support more matchmaking types via the route and/or tabs or something?
  const matchmakingType = MatchmakingType.Match1v1
  const dispatch = useAppDispatch()
  const rankings = useAppSelector(s => s.ladder.typeToRankings.get(matchmakingType))

  useEffect(() => {
    dispatch(getRankings(matchmakingType))
  }, [dispatch, matchmakingType])

  if (!rankings) {
    return null
  }

  return (
    <LadderPage>
      <LadderTable
        totalCount={rankings.totalCount}
        players={rankings.players}
        isLoading={rankings.isLoading}
        lastError={rankings.lastError}
        curTime={Number(rankings.fetchTime)}
      />
    </LadderPage>
  )
}

const ROW_HEIGHT = 48

const TableContainer = styled.div`
  width: 100%;
  height: 100%;
  border-left: var(--pixel-shove-x, 0) transparent;
  padding-left: 16px;

  overflow-x: hidden;
  overflow-y: auto;
`

const StyledTable = styled(Table)`
  position: relative;
  width: 100%;
  height: auto;
  max-width: 640px;
  margin: 24px auto 24px;

  &:focus,
  & > div:focus {
    outline: none;
  }

  .ReactVirtualized__Table__rowColumn {
    height: 100%;
  }

  .ReactVirtualized__Table__headerRow.odd {
    ${shadow4dp};
    position: sticky;
    top: 0;
    background-color: ${grey900};
    contain: content;
  }

  .even {
    background-color: ${grey800};
  }

  .odd {
    background-color: ${grey850};
  }
`

const NumberText = styled.div`
  ${subtitle1};
  width: 100%;
  padding: 0 8px;
  text-align: right;
  line-height: ${ROW_HEIGHT}px;
`

const LastPlayedText = styled.div`
  ${subtitle1};
  width: 100%;
  padding: 0 8px 0 32px;
  color: ${colorTextSecondary};
  line-height: ${ROW_HEIGHT}px;
  text-align: left;
`

const PlayerCell = styled.div`
  width: 100%;
  height: 100%;
  padding: 0 16px;
  display: flex;
  align-items: center;
`

const StyledAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;
  margin-right: 16px;
`

const PlayerName = styled.div`
  ${subtitle2};
  line-height: ${ROW_HEIGHT}px;
`

const ErrorText = styled.div`
  ${subtitle1};
  padding: 16px;

  color: ${colorError};
  text-align: center;
`

const EmptyText = styled.div`
  ${subtitle1};
  padding: 16px;

  color: ${colorTextFaint};
  text-align: center;
`

export interface LadderTableProps {
  curTime: number
  totalCount: number
  isLoading: boolean
  players?: List<Readonly<LadderPlayer>>
  lastError?: Error
}

export function LadderTable(props: LadderTableProps) {
  const [dimensionsRef, containerRect] = useDimensions()
  const containerRef = useRef<HTMLElement | null>(null)
  // multiplex the ref to the container to our own ref + the dimensions one
  const containerCallback = useCallback(
    (node: HTMLElement | null) => {
      dimensionsRef(node)
      containerRef.current = node
    },
    [dimensionsRef],
  )

  const [scrollTop, setScrollTop] = useState(0)
  const containerScrollHandler = useRef<AnimationFrameHandler<HTMLDivElement>>()
  useLayoutEffect(() => {
    containerScrollHandler.current = animationFrameHandler(() => {
      setScrollTop(containerRef.current?.scrollTop ?? 0)
    })
    return () => {
      containerScrollHandler.current?.cancel()
      containerScrollHandler.current = undefined
    }
  }, [])

  const rowGetter = useCallback(({ index }: { index: number }) => props.players?.get(index), [
    props.players,
  ])
  const noRowsRenderer = useCallback(() => {
    if (props.isLoading) {
      return <LoadingDotsArea />
    } else if (props.lastError) {
      return <ErrorText>There was an error retrieving the current rankings.</ErrorText>
    } else {
      return <EmptyText>Nothing to see here</EmptyText>
    }
  }, [props.isLoading, props.lastError])

  const renderPlayer = useCallback<TableCellRenderer>(props => {
    const username = props.cellData.name
    return (
      <PlayerCell>
        <StyledAvatar user={username} />
        <PlayerName>{username}</PlayerName>
      </PlayerCell>
    )
  }, [])
  const renderRating = useCallback<TableCellRenderer>(props => {
    return <NumberText>{Math.round(props.cellData)}</NumberText>
  }, [])
  const renderNumber = useCallback<TableCellRenderer>(props => {
    return <NumberText>{props.cellData}</NumberText>
  }, [])

  const renderWinLoss = useCallback<TableCellRenderer>(props => {
    return (
      <NumberText>
        {props.cellData.wins} &ndash; {props.cellData.losses}
      </NumberText>
    )
  }, [])

  const { curTime } = props
  const curTimeRef = usePropAsRef(curTime)
  const renderLastPlayed = useCallback<TableCellRenderer>(
    props => {
      return <LastPlayedText>{timeAgo(curTimeRef.current - props.cellData)}</LastPlayedText>
    },
    [curTimeRef],
  )

  return (
    <TableContainer ref={containerCallback} onScroll={containerScrollHandler.current?.handler}>
      <StyledTable
        autoHeight={true}
        width={640}
        height={containerRect?.height ?? 0}
        scrollTop={scrollTop}
        headerHeight={ROW_HEIGHT}
        rowHeight={ROW_HEIGHT}
        rowCount={props.totalCount}
        rowClassName={evenOddClassNames}
        rowGetter={rowGetter}
        noRowsRenderer={noRowsRenderer}>
        <Column
          label='Rank'
          dataKey='rank'
          width={64}
          columnData={{ rightAlignHeader: true }}
          cellRenderer={renderNumber}
          headerRenderer={LadderTableHeader}
        />
        <Column
          label='Player'
          dataKey='user'
          width={168}
          flexGrow={1}
          columnData={{ horizontalPadding: 16 }}
          cellRenderer={renderPlayer}
          headerRenderer={LadderTableHeader}
        />
        <Column
          label='Rating'
          dataKey='rating'
          width={64}
          columnData={{ rightAlignHeader: true }}
          cellRenderer={renderRating}
          headerRenderer={LadderTableHeader}
        />
        <Column
          label='Win/loss'
          dataKey=''
          width={128}
          columnData={{ rightAlignHeader: true }}
          cellDataGetter={({ rowData }) => rowData}
          cellRenderer={renderWinLoss}
          headerRenderer={LadderTableHeader}
        />
        <Column
          label='Last played'
          dataKey='lastPlayedDate'
          width={132}
          columnData={{ horizontalPadding: 32 }}
          cellRenderer={renderLastPlayed}
          headerRenderer={LadderTableHeader}
        />
      </StyledTable>
    </TableContainer>
  )
}

const LadderTableHeaderText = styled.div<{
  rightAlignHeader?: boolean
  horizontalPadding?: number
}>`
  ${overline};
  width: 100%;
  color: ${colorTextSecondary};
  padding: 0 ${props => props.horizontalPadding ?? '8'}px;
  line-height: ${ROW_HEIGHT}px;

  ${props => {
    if (props.rightAlignHeader) {
      return 'text-align: right;'
    }

    return ''
  }};
`

function LadderTableHeader(props: TableHeaderProps) {
  return (
    <LadderTableHeaderText
      rightAlignHeader={props.columnData?.rightAlignHeader}
      horizontalPadding={props.columnData?.horizontalPadding}>
      {props.label}
    </LadderTableHeaderText>
  )
}

function evenOddClassNames({ index }: { index: number }): string {
  return index % 2 === 0 ? 'even' : 'odd'
}
