import { List } from 'immutable'
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Column, Table, TableCellRenderer, TableHeaderProps } from 'react-virtualized'
import styled from 'styled-components'
import Avatar from '../avatars/avatar'
import { useHeight } from '../dom/use-dimensions'
import { AnimationFrameHandler, animationFrameHandler } from '../material/animation-frame-handler'
import { colorTextSecondary, grey850 } from '../styles/colors'
import { overline, subtitle1, subtitle2 } from '../styles/typography'

/**
 * Displays a ranked table of players on the ladder(s).
 */
export function Ladder() {
  return <span>#1 - You</span>
}

// TODO(tec27): Move this elsewhere
export interface LadderPlayer {
  rank: number
  user: {
    id: number
    name: string
  }
  rating: number
  wins: number
  losses: number
  lastPlayedDate: number
}

const ROW_HEIGHT = 48

const TableContainer = styled.div`
  width: 100%;
  height: 100%;
  border-left: var(--pixel-shove-x, 0) transparent;
  padding-left: 16px;

  display: flex;

  overflow-x: hidden;
  overflow-y: auto;
`

const StyledTable = styled(Table)`
  flex-grow: 1;
  max-width: 640px;
  margin: 0 auto;

  &:focus,
  & > div:focus {
    outline: none;
  }

  .ReactVirtualized__Table__rowColumn {
    height: 100%;
  }

  .even {
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

export interface LadderTableProps {
  players: List<Readonly<LadderPlayer>>
}

export function LadderTable(props: LadderTableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // TODO(tec27): I think if we put this one component deeper, this coalescing would be
  // unnecessary
  const containerHeight = useHeight(containerRef.current ?? document.body)
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

  const rowGetter = useCallback(({ index }: { index: number }) => props.players.get(index), [
    props.players,
  ])

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

  return (
    <TableContainer ref={containerRef} onScroll={containerScrollHandler.current?.handler}>
      <StyledTable
        autoHeight={true}
        width={640}
        height={containerHeight}
        scrollTop={scrollTop}
        headerHeight={ROW_HEIGHT}
        rowHeight={ROW_HEIGHT}
        rowCount={props.players.size}
        rowClassName={evenOddClassNames}
        rowGetter={rowGetter}>
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
          label='Wins'
          dataKey='wins'
          width={56}
          columnData={{ rightAlignHeader: true }}
          cellRenderer={renderRating}
          headerRenderer={LadderTableHeader}
        />
        <Column
          label='Losses'
          dataKey='losses'
          width={56}
          columnData={{ rightAlignHeader: true }}
          cellRenderer={renderRating}
          headerRenderer={LadderTableHeader}
        />
        <Column width={32} dataKey='' />
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
