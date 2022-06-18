import { Immutable } from 'immer'
import { debounce } from 'lodash-es'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { LadderPlayer } from '../../common/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { SbUser, SbUserId } from '../../common/users/sb-user'
import { Avatar } from '../avatars/avatar'
import { useVirtuosoScrollFix } from '../dom/virtuoso-scroll-fix'
import { longTimestamp, shortTimestamp } from '../i18n/date-formats'
import { JsonLocalStorageValue } from '../local-storage'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { fastOutSlowInShort } from '../material/curves'
import { Ripple } from '../material/ripple'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { shadow4dp } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { SearchInput, SearchInputHandle } from '../search/search-input'
import { useForceUpdate, useStableCallback, useValueAsRef } from '../state-hooks'
import {
  background800,
  colorDividers,
  colorError,
  colorTextFaint,
  colorTextSecondary,
  getRaceColor,
} from '../styles/colors'
import {
  body1,
  caption,
  Headline6,
  overline,
  singleLine,
  subtitle1,
  subtitle2,
} from '../styles/typography'
import { timeAgo } from '../time/time-ago'
import { navigateToUserProfile } from '../users/action-creators'
import { getRankings, navigateToLadder, searchRankings } from './action-creators'

const LadderPage = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const PageHeader = styled.div`
  position: relative;
  width: 100%;
  max-width: 832px;
  padding: 8px 16px;
  flex-shrink: 0;

  display: flex;
  gap: 40px;
  align-items: center;
`

const TABS_MIN_WIDTH_PX =
  ALL_MATCHMAKING_TYPES.length * 100 + (ALL_MATCHMAKING_TYPES.length - 1) * 24

// NOTE(tec27): Using a container here instead of styling directly because styling it results in
// TS not being able to figure out the generic param, so it doesn't like our tab change handler
const TabsContainer = styled.div`
  min-width: ${TABS_MIN_WIDTH_PX}px;
  flex-shrink: 0;
`

const Content = styled.div`
  width: 100%;
  flex-grow: 1;
  flex-shrink: 1;
  overflow: hidden;
`

const savedLadderTab = new JsonLocalStorageValue<MatchmakingType>('ladderTab')

export function LadderRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute<{ matchmakingType: string }>('/ladder/:matchmakingType?')

  if (!matches) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }

  const matchmakingType = ALL_MATCHMAKING_TYPES.includes(params?.matchmakingType as MatchmakingType)
    ? (params!.matchmakingType as MatchmakingType)
    : undefined

  return <Ladder matchmakingType={matchmakingType} />
}

export interface LadderProps {
  matchmakingType?: MatchmakingType
}

/**
 * Displays a ranked table of players on the ladder(s).
 */
export function Ladder({ matchmakingType: routeType }: LadderProps) {
  const matchmakingType = routeType ?? savedLadderTab.getValue() ?? MatchmakingType.Match1v1

  const dispatch = useAppDispatch()
  const rankings = useAppSelector(s => s.ladder.typeToRankings.get(matchmakingType))
  const searchResults = useAppSelector(s => s.ladder.typeToSearchResults.get(matchmakingType))
  const usersById = useAppSelector(s => s.users.byId)

  const searchInputRef = useRef<SearchInputHandle>(null)
  const onTabChange = useCallback((tab: MatchmakingType) => {
    searchInputRef.current?.clear()
    navigateToLadder(tab)
  }, [])

  const [lastError, setLastError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useLocationSearchParam('q')

  const setSearchQueryRef = useValueAsRef(setSearchQuery)
  const debouncedSearchRef = useRef(
    debounce((searchQuery: string) => {
      // TODO(2Pac): Find out why the component gets re-rendered a bunch of times after updating the
      // location and see if there's anything we can do to stop that.
      setSearchQueryRef.current(searchQuery)
    }, 100),
  )

  const [isAtTop, , topNode, bottomNode] = useScrollIndicatorState({
    refreshToken: matchmakingType,
  })

  const onSearchChange = useCallback(
    (searchQuery: string) => {
      if (searchQuery) {
        debouncedSearchRef.current(searchQuery)
      } else {
        // When user clears the search, we don't need to debounce showing the full rankings as
        // they're saved separately from search results.
        setSearchQuery('')
      }
    },
    [setSearchQuery],
  )

  useEffect(() => {
    const getRankingsAbortController = new AbortController()
    const searchRankingsAbortController = new AbortController()
    const debouncedSearch = debouncedSearchRef.current

    if (searchQuery) {
      dispatch(
        searchRankings(matchmakingType, searchQuery, {
          signal: searchRankingsAbortController.signal,
          onSuccess: () => setLastError(undefined),
          onError: err => setLastError(err),
        }),
      )
    } else {
      dispatch(
        getRankings(matchmakingType, {
          signal: getRankingsAbortController.signal,
          onSuccess: () => setLastError(undefined),
          onError: err => setLastError(err),
        }),
      )
    }

    return () => {
      getRankingsAbortController.abort()
      searchRankingsAbortController.abort()
      debouncedSearch.cancel()
    }
  }, [dispatch, matchmakingType, searchQuery])

  useEffect(() => {
    if (routeType) {
      savedLadderTab.setValue(routeType)
    }
  }, [routeType])

  let rankingsData = {
    lastUpdated: 0,
    totalCount: 0,
    players: [] as Immutable<LadderPlayer[]>,
    curTime: 0,
  }
  if (searchQuery && searchResults) {
    rankingsData = {
      lastUpdated: searchResults.lastUpdated,
      totalCount: searchResults.totalCount,
      players: searchResults.players,
      curTime: Number(searchResults.fetchTime),
    }
  } else if (rankings) {
    rankingsData = {
      lastUpdated: rankings.lastUpdated,
      totalCount: rankings.totalCount,
      players: rankings.players,
      curTime: Number(rankings.fetchTime),
    }
  }

  return (
    <LadderPage>
      <PageHeader>
        <Headline6>Ladder</Headline6>
        <TabsContainer>
          <Tabs activeTab={matchmakingType} onChange={onTabChange}>
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match1v1)}
              value={MatchmakingType.Match1v1}
            />
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match2v2)}
              value={MatchmakingType.Match2v2}
            />
          </Tabs>
        </TabsContainer>
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </PageHeader>
      <Content>
        {searchResults || rankings ? (
          <LadderTable
            {...rankingsData}
            usersById={usersById}
            lastError={lastError}
            searchInputRef={searchInputRef}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            topNode={topNode}
            bottomNode={bottomNode}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </Content>
    </LadderPage>
  )
}

const TableContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;

  overflow-x: hidden;
  overflow-y: auto;
`

const SearchContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;

  width: 100%;
  max-width: min(800px, 100% - 32px);
  margin: 16px 16px 8px;
`

const StyledSearchInput = styled(SearchInput)`
  width: 200px;
  ${fastOutSlowInShort};

  &:focus-within {
    width: 256px;
  }
`

const LastUpdatedText = styled.div`
  ${body1};
  padding: 0 16px;

  color: ${colorTextSecondary};
  text-align: right;
`

const Table = styled.div`
  width: 100%;
  height: auto;
  max-width: min(800px, 100% - 32px);
  margin: 8px 16px 0px;
  padding-bottom: 16px;
  border: 1px solid ${colorDividers};
  border-radius: 2px;
`

const RowContainer = styled.button<{ $isEven: boolean }>`
  ${buttonReset};

  ${subtitle1};
  width: 100%;
  height: 64px;
  padding: 0;

  display: flex;
  align-items: center;

  --sb-ladder-row-height: 64px;
`

const HEADER_STUCK_CLASS = 'sb-ladder-table-sticky-header'

const HeaderRowContainer = styled.div<{ context?: unknown }>`
  ${overline};
  width: 100%;
  height: 48px;
  position: sticky !important;
  top: 0;

  display: flex;
  align-items: center;

  background-color: ${background800};
  color: ${colorTextSecondary} !important;
  contain: content;

  --sb-ladder-row-height: 48px;

  .${HEADER_STUCK_CLASS} & {
    ${shadow4dp};
    border-bottom: 1px solid ${colorDividers};
  }
`

const BaseCell = styled.div`
  height: 100%;
  flex: 1 1 auto;
  padding: 0 8px;
  line-height: var(--sb-ladder-row-height, 64px);
`

const RankCell = styled(BaseCell)`
  width: 64px;
  padding-left: 16px;
  text-align: right;
`

const PlayerCell = styled(BaseCell)`
  width: 176px;
  padding: 0 16px;
  display: flex;
  align-items: center;
`

const PointsCell = styled(BaseCell)`
  width: 56px;
  text-align: right;
`

const RatingCell = styled(BaseCell)`
  width: 56px;
  text-align: right;
`

const WinLossCell = styled(BaseCell)`
  width: 112px;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: flex-end;

  // Reset the line-height in here, the flex will handle vertical centering and this will allow
  // records to split across lines if needed
  line-height: 1.5;
  text-align: right;
`

const LastPlayedCell = styled(BaseCell)`
  width: 156px;
  padding: 0 16px 0 32px;
  color: ${colorTextSecondary};
  text-align: right;
`

const StyledAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  margin-right: 16px;
`

const PlayerNameAndRace = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const PlayerName = styled.div`
  ${subtitle2};
  ${singleLine};
`

const PlayerRace = styled.div<{ $race: RaceChar }>`
  ${caption};
  color: ${props => getRaceColor(props.$race)};
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
  players?: ReadonlyArray<LadderPlayer>
  usersById: Immutable<Map<SbUserId, SbUser>>
  lastUpdated: number
  lastError?: Error
  searchInputRef?: React.RefObject<SearchInputHandle>
  searchQuery: string
  onSearchChange: (value: string) => void
  topNode?: React.ReactNode
  bottomNode?: React.ReactNode
}

export function LadderTable(props: LadderTableProps) {
  const [setScrollerRef] = useVirtuosoScrollFix()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const forceUpdate = useForceUpdate()
  const setContainerRef = useCallback(
    (ref: HTMLDivElement | null) => {
      if (containerRef.current !== ref) {
        setScrollerRef(ref)
        containerRef.current = ref
        if (ref !== null) {
          forceUpdate()
        }
      }
    },
    [forceUpdate, setScrollerRef],
  )

  const {
    players,
    usersById,
    lastError,
    curTime,
    searchInputRef,
    searchQuery,
    onSearchChange,
    topNode,
    bottomNode,
  } = props

  const [isHeaderUnstuck, , topHeaderNode, bottomHeaderNode] = useScrollIndicatorState({
    refreshToken: players,
  })

  const onRowSelected = useCallback((userId: SbUserId, username: string) => {
    navigateToUserProfile(userId, username)
  }, [])

  const renderRow = useStableCallback((index: number, player: LadderPlayer) => {
    const username = usersById.get(player.userId)?.name ?? ''

    return (
      <Row
        key={player.userId}
        isEven={index % 2 === 0}
        player={player}
        username={username}
        curTime={curTime}
        onSelected={onRowSelected}
      />
    )
  })

  const emptyContent = lastError ? (
    <ErrorText>There was an error retrieving the current rankings.</ErrorText>
  ) : (
    <EmptyText>Nothing to see here</EmptyText>
  )

  return (
    <TableContainer ref={setContainerRef}>
      {topNode}
      <SearchContainer>
        <StyledSearchInput
          ref={searchInputRef}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
        />
        <LastUpdatedText title={longTimestamp.format(props.lastUpdated)}>
          Last updated: {shortTimestamp.format(props.lastUpdated)}
        </LastUpdatedText>
      </SearchContainer>
      {topHeaderNode}
      {containerRef.current && (players?.length ?? 0) > 0 ? (
        <TableVirtuoso
          className={isHeaderUnstuck ? '' : HEADER_STUCK_CLASS}
          customScrollParent={containerRef.current}
          fixedHeaderContent={Header}
          components={{
            Table,
            TableHead: HeaderRowContainer,
            TableBody,
            TableRow,
            FillerRow,
          }}
          data={players}
          itemContent={renderRow}
        />
      ) : (
        emptyContent
      )}
      {bottomHeaderNode}
      {bottomNode}
    </TableContainer>
  )
}

const Header = () => (
  <>
    <RankCell>Rank</RankCell>
    <PlayerCell>Player</PlayerCell>
    <PointsCell>Points</PointsCell>
    <RatingCell>MMR</RatingCell>
    <WinLossCell>Win/loss</WinLossCell>
    <LastPlayedCell>Last played</LastPlayedCell>
  </>
)

// TODO(2Pac): react-virtuoso types expect the `ref` here to point to a `tbody` element. I opened an
// issue on their github page: https://github.com/petyosi/react-virtuoso/issues/644
const TableBody = React.forwardRef((props, ref: React.ForwardedRef<any>) => (
  <div ref={ref} {...props} />
))

const TableRow = styled.div``

const FillerRow = styled.div<{ height: number }>`
  height: ${props => `${props.height}px`};
`

interface RowProps {
  isEven: boolean
  player: LadderPlayer
  username: string
  curTime: number
  onSelected?: (userId: SbUserId, username: string) => void
}

const Row = React.memo(({ isEven, player, username, curTime, onSelected }: RowProps) => {
  const onClick = useCallback(() => {
    if (onSelected) {
      onSelected(player.userId, username)
    }
  }, [onSelected, player, username])
  const [buttonProps, rippleRef] = useButtonState({ onClick })

  const raceStats: Array<[number, RaceChar]> = [
    [player.pWins + player.pLosses, 'p'],
    [player.tWins + player.tLosses, 't'],
    [player.zWins + player.zLosses, 'z'],
    [player.rWins + player.rLosses, 'r'],
  ]
  raceStats.sort((a, b) => b[0] - a[0])
  const mostPlayedRace = raceStats[0][1]

  return (
    <RowContainer $isEven={isEven} {...buttonProps}>
      <RankCell>{player.rank}</RankCell>
      <PlayerCell>
        <StyledAvatar user={username} />
        <PlayerNameAndRace>
          <PlayerName>{username}</PlayerName>
          <PlayerRace $race={mostPlayedRace}>{raceCharToLabel(mostPlayedRace)}</PlayerRace>
        </PlayerNameAndRace>
      </PlayerCell>
      <PointsCell>{Math.round(player.points)}</PointsCell>
      <RatingCell>{Math.round(player.rating)}</RatingCell>
      <WinLossCell>
        {player.wins} &ndash; {player.losses}
      </WinLossCell>
      <LastPlayedCell>{timeAgo(curTime - player.lastPlayedDate)}</LastPlayedCell>
      <Ripple ref={rippleRef} />
    </RowContainer>
  )
})
