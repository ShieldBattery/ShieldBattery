import { Immutable } from 'immer'
import { debounce } from 'lodash-es'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingType,
  matchmakingTypeToLabel,
  NUM_PLACEMENT_MATCHES,
} from '../../common/matchmaking'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { SbUser, SbUserId } from '../../common/users/sb-user'
import { Avatar } from '../avatars/avatar'
import { longTimestamp, narrowDuration, shortTimestamp } from '../i18n/date-formats'
import { JsonLocalStorageValue } from '../local-storage'
import { LadderPlayerIcon } from '../matchmaking/rank-icon'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { shadow4dp } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
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
import { navigateToUserProfile } from '../users/action-creators'
import { getRankings, navigateToLadder, searchRankings } from './action-creators'
import { useTranslation } from 'react-i18next'

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

const LastUpdatedText = styled.div`
  ${body1};
  padding-right: 16px;
  flex-grow: 1;
  flex-shrink: 0;

  color: ${colorTextSecondary};
  text-align: right;
`

const savedLadderTab = new JsonLocalStorageValue<MatchmakingType>('ladderTab')

export function LadderRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute('/ladder/:matchmakingType?')

  if (!matches) {
    return null
  }

  const matchmakingType = ALL_MATCHMAKING_TYPES.includes(params.matchmakingType as MatchmakingType)
    ? (params.matchmakingType as MatchmakingType)
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
  const { t } = useTranslation()
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
  const [filteredDivision, setFilteredDivision] = useLocationSearchParam('division', push)

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

  useEffect(() => {
    if (filteredDivision) {
      if (!ALL_DIVISION_FILTERS.includes(filteredDivision as DivisionFilter)) {
        setFilteredDivision('')
      }
    }
  }, [filteredDivision, setFilteredDivision])

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
        <Headline6>{t('ladder.ladderHeader', 'Ladder')}</Headline6>
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
        {rankingsData ? (
          <LastUpdatedText title={longTimestamp.format(rankingsData.lastUpdated)}>
            {t('ladder.updatedText', 'Updated')}: {shortTimestamp.format(rankingsData.lastUpdated)}
          </LastUpdatedText>
        ) : null}
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </PageHeader>
      <Content>
        {rankingsData ? (
          <LadderTable
            {...rankingsData}
            usersById={usersById}
            lastError={lastError}
            searchInputRef={searchInputRef}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            filteredDivision={(filteredDivision || 'all') as DivisionFilter}
            onFilteredDivisionChange={setFilteredDivision}
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

const FiltersContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;

  width: 100%;
  max-width: min(800px, 100% - 32px);
  margin: 16px 16px 8px;
`

const StyledSearchInput = styled(SearchInput)`
  width: 256px;
`

const DivisionSelect = styled(Select)`
  width: 148px;
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
  height: 72px;
  padding: 0;

  display: flex;
  align-items: center;

  --sb-ladder-row-height: 72px;
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
  line-height: var(--sb-ladder-row-height, 72px);
`

const RankCell = styled(BaseCell)`
  width: 112px;
  padding-left: 16px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
  width: 140px;
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

export enum DivisionFilter {
  All = 'all',
  Champion = 'champion',
  Diamond = 'diamond',
  Platinum = 'platinum',
  Gold = 'gold',
  Silver = 'silver',
  Bronze = 'bronze',
  Unrated = 'unrated',
}

const ALL_DIVISION_FILTERS: ReadonlyArray<DivisionFilter> = Object.values(DivisionFilter)

export interface LadderTableProps {
  curTime: number
  players?: ReadonlyArray<LadderPlayer>
  usersById: Immutable<Map<SbUserId, SbUser>>
  lastUpdated: number
  lastError?: Error
  searchInputRef?: React.RefObject<SearchInputHandle>
  searchQuery: string
  onSearchChange: (value: string) => void
  filteredDivision: DivisionFilter
  onFilteredDivisionChange: (value: DivisionFilter) => void
  topNode?: React.ReactNode
  bottomNode?: React.ReactNode
}

export function LadderTable(props: LadderTableProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const forceUpdate = useForceUpdate()
  const setContainerRef = useCallback(
    (ref: HTMLDivElement | null) => {
      if (containerRef.current !== ref) {
        containerRef.current = ref
        if (ref !== null) {
          forceUpdate()
        }
      }
    },
    [forceUpdate],
  )

  const {
    players,
    usersById,
    lastError,
    curTime,
    searchInputRef,
    searchQuery,
    onSearchChange,
    filteredDivision,
    onFilteredDivisionChange,
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
  const { t } = useTranslation()
  const emptyContent = lastError ? (
    <ErrorText>{t('ladder.errorRetrievingRankings', 'There was an error retrieving the current rankings.')}</ErrorText>
  ) : (
    <EmptyText>{t('ladder.errorNoMatchingPlayers', 'No matching players.')}</EmptyText>
  )

  const data = useMemo(() => {
    if (
      !players ||
      filteredDivision === DivisionFilter.All ||
      !ALL_DIVISION_FILTERS.includes(filteredDivision)
    ) {
      return players
    }

    const playersWithDivs = players.map<[player: LadderPlayer, division: MatchmakingDivision]>(
      p => [p, ladderPlayerToMatchmakingDivision(p)],
    )

    switch (filteredDivision) {
      case DivisionFilter.Bronze:
        return playersWithDivs
          .filter(
            ([, div]) =>
              div === MatchmakingDivision.Bronze1 ||
              div === MatchmakingDivision.Bronze2 ||
              div === MatchmakingDivision.Bronze3,
          )
          .map(([p]) => p)
      case DivisionFilter.Silver:
        return playersWithDivs
          .filter(
            ([, div]) =>
              div === MatchmakingDivision.Silver1 ||
              div === MatchmakingDivision.Silver2 ||
              div === MatchmakingDivision.Silver3,
          )
          .map(([p]) => p)
      case DivisionFilter.Gold:
        return playersWithDivs
          .filter(
            ([, div]) =>
              div === MatchmakingDivision.Gold1 ||
              div === MatchmakingDivision.Gold2 ||
              div === MatchmakingDivision.Gold3,
          )
          .map(([p]) => p)
      case DivisionFilter.Platinum:
        return playersWithDivs
          .filter(
            ([, div]) =>
              div === MatchmakingDivision.Platinum1 ||
              div === MatchmakingDivision.Platinum2 ||
              div === MatchmakingDivision.Platinum3,
          )
          .map(([p]) => p)
      case DivisionFilter.Diamond:
        return playersWithDivs
          .filter(
            ([, div]) =>
              div === MatchmakingDivision.Diamond1 ||
              div === MatchmakingDivision.Diamond2 ||
              div === MatchmakingDivision.Diamond3,
          )
          .map(([p]) => p)
      case DivisionFilter.Champion:
        return playersWithDivs
          .filter(([, div]) => div === MatchmakingDivision.Champion)
          .map(([p]) => p)
      case DivisionFilter.Unrated:
        return playersWithDivs
          .filter(([, div]) => div === MatchmakingDivision.Unrated)
          .map(([p]) => p)

      default:
        return assertUnreachable(filteredDivision)
    }
  }, [players, filteredDivision])

  return (
    <TableContainer ref={setContainerRef}>
      {topNode}
      <FiltersContainer>
        <StyledSearchInput
          ref={searchInputRef}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
        />
        <DivisionSelect
          dense={true}
          label={'Division'}
          value={filteredDivision}
          onChange={onFilteredDivisionChange}
          allowErrors={false}>
          <SelectOption value={DivisionFilter.All} text={'All'} />
          <SelectOption value={DivisionFilter.Champion} text={'Champion'} />
          <SelectOption value={DivisionFilter.Diamond} text={'Diamond'} />
          <SelectOption value={DivisionFilter.Platinum} text={'Platinum'} />
          <SelectOption value={DivisionFilter.Gold} text={'Gold'} />
          <SelectOption value={DivisionFilter.Silver} text={'Silver'} />
          <SelectOption value={DivisionFilter.Bronze} text={'Bronze'} />
          <SelectOption value={DivisionFilter.Unrated} text={'Unrated'} />
        </DivisionSelect>
      </FiltersContainer>
      {topHeaderNode}
      {containerRef.current && (data?.length ?? 0) > 0 ? (
        <TableVirtuoso
          className={isHeaderUnstuck ? '' : HEADER_STUCK_CLASS}
          customScrollParent={containerRef.current}
          fixedHeaderContent={Header}
          components={{
            Table,
            // NOTE(tec27): virtuoso expects a table section here, even though it doesn't *really*
            // care. Because of that though, the typings clash with what is acceptable for `ref`
            // props, so we cast to `any` to get past that error
            TableHead: HeaderRowContainer as any,
            TableBody,
            TableRow,
            FillerRow,
          }}
          data={data}
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
const { t } = useTranslation()
const Header = () => (
  <>
    <RankCell>
      <span></span>
      <span>{t('ladder.rankHeader', 'Rank')}</span>
    </RankCell>
    <PlayerCell>{t('ladder.playerHeader', 'Player')}</PlayerCell>
    <PointsCell>{t('ladder.pointsHeader', 'Points')}</PointsCell>
    <RatingCell>{t('ladder.mmrHeader', 'MMR')}</RatingCell>
    <WinLossCell>{t('ladder.winLossHeader', 'Win/loss')}</WinLossCell>
    <LastPlayedCell>{t('ladder.lastPlayedHeader', 'Last played')}</LastPlayedCell>
  </>
)

// TODO(2Pac): react-virtuoso types expect the `ref` here to point to a `tbody` element. I opened an
// issue on their github page: https://github.com/petyosi/react-virtuoso/issues/644
const TableBody = React.forwardRef((props, ref: React.ForwardedRef<any>) => (
  <div ref={ref} {...props} />
))

const TableRow = styled.div``

const FillerRow = styled.div.attrs<{ height: number }>(props => ({
  style: { height: `${props.height}px` },
}))<{ height: number }>``

const UnratedText = styled.span`
  color: ${colorTextFaint};
`

const DivisionIcon = styled(LadderPlayerIcon)`
  width: 44px;
  height: 44px;
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

  const division = ladderPlayerToMatchmakingDivision(player)
  const divisionLabel = matchmakingDivisionToLabel(division)

  return (
    <RowContainer $isEven={isEven} {...buttonProps}>
      <RankCell>
        <Tooltip text={divisionLabel} position='bottom'>
          <DivisionIcon player={player} size={44} />
        </Tooltip>
        <span>{player.rank}</span>
      </RankCell>
      <PlayerCell>
        <StyledAvatar user={username} />
        <PlayerNameAndRace>
          <PlayerName>{username}</PlayerName>
          <PlayerRace $race={mostPlayedRace}>{raceCharToLabel(mostPlayedRace)}</PlayerRace>
        </PlayerNameAndRace>
      </PlayerCell>
      <PointsCell>{Math.round(player.points)}</PointsCell>
      <RatingCell>
        {player.lifetimeGames >= NUM_PLACEMENT_MATCHES ? (
          Math.round(player.rating)
        ) : (
          <UnratedText>&mdash;</UnratedText>
        )}
      </RatingCell>
      <WinLossCell>
        {player.wins} &ndash; {player.losses}
      </WinLossCell>
      <LastPlayedCell>{narrowDuration.format(player.lastPlayedDate, curTime)}</LastPlayedCell>
      <Ripple ref={rippleRef} />
    </RowContainer>
  )
})
