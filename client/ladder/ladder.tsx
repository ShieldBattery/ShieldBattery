import { Immutable } from 'immer'
import { debounce } from 'lodash-es'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ContextProp,
  TableBodyProps,
  TableComponents,
  TableVirtuoso,
  TableVirtuosoHandle,
} from 'react-virtuoso'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  getTotalBonusPoolForSeason,
  makeSeasonId,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  MatchmakingType,
  matchmakingTypeToLabel,
  NUM_PLACEMENT_MATCHES,
  SeasonId,
} from '../../common/matchmaking'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { urlPath } from '../../common/urls'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { Avatar } from '../avatars/avatar'
import { useTargetVisibleInScrollParent } from '../dom/visibility-hooks'
import { longTimestamp, narrowDuration, shortTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { JsonLocalStorageValue } from '../local-storage'
import { getMatchmakingSeasons } from '../matchmaking/action-creators'
import { MatchmakingTypeNav } from '../matchmaking/matchmaking-type-nav'
import { LadderPlayerIcon } from '../matchmaking/rank-icon'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { elevationPlus1, elevationPlus2, elevationPlus3 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useValueAsRef } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { SearchInput, SearchInputHandle } from '../search/search-input'
import { getRaceColor } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import {
  bodyLarge,
  bodyMedium,
  labelLarge,
  labelMedium,
  singleLine,
  sofiaSansCondensed,
  TitleLarge,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { navigateToUserProfile } from '../users/action-creators'
import {
  getCurrentSeasonRankings,
  getPreviousSeasonRankings,
  navigateToLadder,
  searchCurrentSeasonRankings,
  searchPreviousSeasonRankings,
} from './action-creators'

const LadderPage = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: row;

  overflow: hidden;
`

const Rail = styled.div`
  flex-shrink: 0;
  width: 224px;
  height: 100%;
  padding: 16px 12px;

  display: flex;
  flex-direction: column;
  gap: 4px;

  background-color: var(--theme-container-lowest);
  border-right: 1px solid rgb(from var(--color-blue80) r g b / 0.07);
  overflow-y: auto;
`

const RailTitle = styled(TitleLarge)`
  padding: 0 12px 8px;
`

const SeasonSection = styled.div`
  padding: 12px 4px 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const RailEyebrow = styled.div`
  ${labelMedium};
  padding: 0 8px;

  color: var(--theme-on-surface-variant);
  letter-spacing: 0.8px;
  text-transform: uppercase;
`

const SeasonSelect = styled(Select)`
  width: 100%;
`

const MainColumn = styled.div`
  position: relative;
  flex-grow: 1;
  min-width: 0;
  height: 100%;

  display: flex;
  flex-direction: column;
`

const ContentHeader = styled.div`
  position: relative;
  flex-shrink: 0;
  padding: 16px 24px 12px;

  display: flex;
  align-items: center;
  gap: 16px;
`

const ModeHeading = styled.div`
  min-width: 0;
`

const ModeTitle = styled.div`
  ${titleLarge};
  ${singleLine};
`

const ModeSubtitle = styled.div`
  ${bodyMedium};
  margin-top: 2px;

  color: var(--theme-on-surface-variant);
`

const HeaderSearchInput = styled(SearchInput)`
  width: 220px;
`

const DivisionSelect = styled(Select)`
  width: 148px;
  flex-shrink: 0;
`

const ContentBody = styled.div`
  position: relative;
  flex-grow: 1;
  min-height: 0;
`

const savedLadderTab = new JsonLocalStorageValue<MatchmakingType>('ladderTab')

export function LadderRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute('/ladder/:matchmakingType?/:seasonId?')

  if (!matches) {
    return null
  }

  const matchmakingType = ALL_MATCHMAKING_TYPES.includes(params.matchmakingType as MatchmakingType)
    ? (params.matchmakingType as MatchmakingType)
    : undefined
  const seasonId = params.seasonId ? makeSeasonId(Number(params.seasonId)) : undefined

  return <Ladder matchmakingType={matchmakingType} seasonId={seasonId} />
}

export interface LadderProps {
  matchmakingType?: MatchmakingType
  seasonId?: SeasonId
}

/**
 * Displays a ranked table of players on the ladder(s).
 */
export function Ladder({ matchmakingType: routeType, seasonId }: LadderProps) {
  const matchmakingType = routeType ?? savedLadderTab.getValue() ?? MatchmakingType.Match1v1
  useTrackPageView(urlPath`/ladder/${matchmakingType}`)
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const seasons = useAppSelector(s => s.matchmakingSeasons.byId)
  const currentSeasonId = useAppSelector(s => s.matchmakingSeasons.currentSeasonId)
  const currentSeasonIdRef = useValueAsRef(currentSeasonId)
  const rankings = useAppSelector(s => {
    if (seasonId) {
      return s.ladder.typeAndSeasonToRankings.get(`${matchmakingType}|${seasonId}`)
    } else if (currentSeasonId) {
      return s.ladder.typeAndSeasonToRankings.get(`${matchmakingType}|${currentSeasonId}`)
    } else {
      return undefined
    }
  })
  const searchResults = useAppSelector(s => {
    if (seasonId) {
      return s.ladder.typeAndSeasonToSearchResults.get(`${matchmakingType}|${seasonId}`)
    } else if (currentSeasonId) {
      return s.ladder.typeAndSeasonToSearchResults.get(`${matchmakingType}|${currentSeasonId}`)
    } else {
      return undefined
    }
  })
  const usersById = useAppSelector(s => s.users.byId)

  const searchInputRef = useRef<SearchInputHandle>(null)
  const onTabChange = useCallback(
    (tab: MatchmakingType) => {
      searchInputRef.current?.clear()
      navigateToLadder(tab, seasonId)
    },
    [seasonId],
  )

  const onSeasonChange = useCallback(
    (seasonId: SeasonId) => {
      navigateToLadder(matchmakingType, seasonId)
    },
    [matchmakingType],
  )

  const [lastError, setLastError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useLocationSearchParam('q')
  const [filteredDivision, setFilteredDivision] = useLocationSearchParam('division', push)

  const setSearchQueryRef = useValueAsRef(setSearchQuery)
  const debouncedSearchRef = useRef(
    // eslint-disable-next-line react-hooks/refs -- ref is only read when the debounced handler fires, not during render
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
    dispatch(
      getMatchmakingSeasons({
        onSuccess: () => setLastError(undefined),
        onError: err => setLastError(err),
      }),
    )
  }, [dispatch])

  useEffect(() => {
    const getRankingsAbortController = new AbortController()
    const searchRankingsAbortController = new AbortController()
    const getPastRankingsAbortController = new AbortController()
    const searchPastRankingsAbortController = new AbortController()
    const debouncedSearch = debouncedSearchRef.current

    // NOTE(2Pac): Since we want to initiate the requests for retrieving the rankings and retrieving
    // all of the seasons, including the `currentSeasonId`, at the same time (without having the
    // waterfall requests), we're using the ref here for the `currentSeasonId` to avoid running this
    // effect again when the `currentSeasonId` changes (e.g. from `undefined` -> actual value). It
    // also wouldn't really make sense to run this effect again in case the `currentSeasonId` gets
    // updated through websockets or something since that would change the rankings the user is
    // looking at without their input.
    const isForCurrentSeason =
      !seasonId || !currentSeasonIdRef.current || seasonId === currentSeasonIdRef.current

    if (isForCurrentSeason) {
      if (searchQuery) {
        dispatch(
          searchCurrentSeasonRankings(matchmakingType, searchQuery, {
            signal: searchRankingsAbortController.signal,
            onSuccess: () => setLastError(undefined),
            onError: err => setLastError(err),
          }),
        )
      } else {
        dispatch(
          getCurrentSeasonRankings(matchmakingType, {
            signal: getRankingsAbortController.signal,
            onSuccess: () => setLastError(undefined),
            onError: err => setLastError(err),
          }),
        )
      }
    } else {
      if (searchQuery) {
        dispatch(
          searchPreviousSeasonRankings(matchmakingType, seasonId, searchQuery, {
            signal: searchPastRankingsAbortController.signal,
            onSuccess: () => setLastError(undefined),
            onError: err => setLastError(err),
          }),
        )
      } else {
        dispatch(
          getPreviousSeasonRankings(matchmakingType, seasonId, {
            signal: getPastRankingsAbortController.signal,
            onSuccess: () => setLastError(undefined),
            onError: err => setLastError(err),
          }),
        )
      }
    }

    return () => {
      getRankingsAbortController.abort()
      searchRankingsAbortController.abort()
      getPastRankingsAbortController.abort()
      searchPastRankingsAbortController.abort()
      debouncedSearch.cancel()
    }
  }, [currentSeasonIdRef, dispatch, matchmakingType, searchQuery, seasonId])

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

  const activeSeasonId = seasonId ?? currentSeasonId
  const season = activeSeasonId ? seasons.get(activeSeasonId) : undefined

  const subtitle = [
    season?.name,
    t('ladder.playerCount', '{{total}} players', { total: rankingsData.totalCount }),
    rankingsData.lastUpdated
      ? t('ladder.updatedText', 'Updated: {{timestamp}}', {
          timestamp: shortTimestamp.format(rankingsData.lastUpdated),
        })
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <LadderPage>
      <Rail>
        <RailTitle>{t('ladder.pageHeadline', 'Ladder')}</RailTitle>
        <MatchmakingTypeNav
          label={t('ladder.modeLabel', 'Mode')}
          activeType={matchmakingType}
          onChange={onTabChange}
        />
        <FlexSpacer />
        <SeasonSection>
          <RailEyebrow>{t('ladder.season', 'Season')}</RailEyebrow>
          <SeasonSelect
            dense={true}
            value={season?.id}
            onChange={onSeasonChange}
            allowErrors={false}>
            {Array.from(seasons.values()).map(s => (
              <SelectOption key={s.id} value={s.id} text={s.name} />
            ))}
          </SeasonSelect>
        </SeasonSection>
      </Rail>
      <MainColumn>
        <ContentHeader>
          <ModeHeading>
            <ModeTitle>{matchmakingTypeToLabel(matchmakingType, t)}</ModeTitle>
            <ModeSubtitle
              title={
                rankingsData.lastUpdated
                  ? longTimestamp.format(rankingsData.lastUpdated)
                  : undefined
              }>
              {subtitle}
            </ModeSubtitle>
          </ModeHeading>
          <FlexSpacer />
          <HeaderSearchInput
            ref={searchInputRef}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
          />
          <DivisionSelect
            dense={true}
            label={t('ladder.division', 'Division')}
            value={(filteredDivision || 'all') as DivisionFilter}
            onChange={setFilteredDivision}
            allowErrors={false}>
            <SelectOption value={DivisionFilter.All} text={t('ladder.divisionGroup.all', 'All')} />
            <SelectOption
              value={DivisionFilter.Champion}
              text={t('ladder.divisionGroup.champion', 'Champion')}
            />
            <SelectOption
              value={DivisionFilter.Diamond}
              text={t('ladder.divisionGroup.diamond', 'Diamond')}
            />
            <SelectOption
              value={DivisionFilter.Platinum}
              text={t('ladder.divisionGroup.platinum', 'Platinum')}
            />
            <SelectOption
              value={DivisionFilter.Gold}
              text={t('ladder.divisionGroup.gold', 'Gold')}
            />
            <SelectOption
              value={DivisionFilter.Silver}
              text={t('ladder.divisionGroup.silver', 'Silver')}
            />
            <SelectOption
              value={DivisionFilter.Bronze}
              text={t('ladder.divisionGroup.bronze', 'Bronze')}
            />
            <SelectOption
              value={DivisionFilter.Unrated}
              text={t('ladder.divisionGroup.unrated', 'Unrated')}
            />
          </DivisionSelect>
          <ScrollDivider $show={!isAtTop} $showAt='bottom' />
        </ContentHeader>
        <ContentBody>
          {rankingsData && currentSeasonId ? (
            <LadderTable
              {...rankingsData}
              season={season}
              usersById={usersById}
              lastError={lastError}
              searchQuery={searchQuery}
              filteredDivision={(filteredDivision || 'all') as DivisionFilter}
              selfUserId={selfUser?.id}
              topNode={topNode}
              bottomNode={bottomNode}
            />
          ) : (
            <LoadingDotsArea />
          )}
        </ContentBody>
      </MainColumn>
    </LadderPage>
  )
}

const TableContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  margin: 0;
  /*
    NOTE(tec27): since we always have a scrollbar gutter, that effectively adds padding to the
    right side, so we need less there to make it even
  */
  padding: 0 8px 24px 24px;

  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
`

const Podium = styled.div`
  width: 100%;
  max-width: 800px;
  margin: 16px auto 8px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const RunnersUp = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`

const SpotlightCard = styled.button`
  ${buttonReset};
  ${elevationPlus1};

  position: relative;
  padding: 18px 22px;

  display: flex;
  align-items: center;
  gap: 18px;

  border-radius: 10px;
  overflow: hidden;
  text-align: left;
  background: linear-gradient(
    120deg,
    var(--color-blue30),
    var(--color-blue20) 55%,
    var(--color-purple30)
  );
`

const SpotlightRank = styled.div`
  ${sofiaSansCondensed};
  flex-shrink: 0;

  color: var(--theme-amber);
  font-size: 54px;
  line-height: 1;
`

const SpotlightIcon = styled(LadderPlayerIcon)`
  width: 64px;
  height: 64px;
  flex-shrink: 0;
`

const SpotlightInfo = styled.div`
  min-width: 0;
  flex-grow: 1;
`

const SpotlightName = styled.div`
  ${titleLarge};
  ${singleLine};
`

const SpotlightMeta = styled.div`
  ${bodyMedium};
  margin-top: 6px;

  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  color: var(--theme-on-surface-variant);
`

const SpotlightPoints = styled.div`
  flex-shrink: 0;
  text-align: right;
`

const SpotlightPointsValue = styled.div`
  ${sofiaSansCondensed};

  color: var(--theme-amber);
  font-size: 38px;
  line-height: 1;
`

const SpotlightPointsLabel = styled.span`
  ${labelLarge};
  color: var(--color-amber70);
`

const SpotlightMmr = styled.div`
  ${bodyMedium};
  margin-top: 6px;

  color: var(--theme-on-surface-variant);
`

const RunnerUpCard = styled.button<{ $medalColor: string }>`
  ${buttonReset};
  ${elevationPlus1};

  padding: 14px 16px;

  display: flex;
  align-items: center;
  gap: 12px;

  border: 1px solid ${props => `rgb(from ${props.$medalColor} r g b / 0.3)`};
  border-radius: 8px;
  text-align: left;
  background: ${props =>
    `linear-gradient(120deg, rgb(from ${props.$medalColor} r g b / 0.13), var(--theme-container-low) 70%)`};
`

const RunnerUpRank = styled.div<{ $medalColor: string }>`
  ${sofiaSansCondensed};
  flex-shrink: 0;
  min-width: 28px;

  color: ${props => props.$medalColor};
  font-size: 30px;
  line-height: 1;
`

const RunnerUpIcon = styled(LadderPlayerIcon)`
  width: 44px;
  height: 44px;
  flex-shrink: 0;
`

const RunnerUpInfo = styled.div`
  min-width: 0;
  flex-grow: 1;
`

const RunnerUpName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const RunnerUpPoints = styled.div`
  flex-shrink: 0;
  text-align: right;
`

const RunnerUpPointsValue = styled.div`
  ${titleSmall};
  color: var(--color-amber70);
`

const RunnerUpMmr = styled.div`
  ${labelMedium};
  margin-top: 2px;

  color: var(--theme-on-surface-variant);
`

const DivisionLabelText = styled.span<{ $color: string }>`
  ${labelLarge};
  color: ${props => props.$color};
`

const RaceBadge = styled.span<{ $race: RaceChar }>`
  ${labelMedium};
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;

  border-radius: 4px;
  background-color: ${props => getRaceColor(props.$race)};
  color: var(--color-grey10);
`

const JumpButton = styled.button`
  ${buttonReset};
  ${elevationPlus3};

  position: absolute;
  right: 24px;
  bottom: 22px;
  z-index: 5;

  height: 44px;
  padding: 0 20px;

  display: inline-flex;
  align-items: center;
  gap: 8px;

  border-radius: 22px;
  background-color: var(--theme-amber);
  color: var(--theme-on-amber);
  font-weight: 600;
`

// There's no theme token for a bronze/copper tone, so we use the value from the design directly.
const BRONZE_COLOR = '#cf9069'

function getDivisionColor(division: MatchmakingDivision): string {
  if (division === MatchmakingDivision.Champion) {
    return 'var(--theme-amber)'
  } else if (division.startsWith('diamond')) {
    return 'var(--color-purple80)'
  } else if (division.startsWith('platinum')) {
    return 'var(--color-blue80)'
  } else if (division.startsWith('gold')) {
    return 'var(--color-amber80)'
  } else if (division.startsWith('silver')) {
    return 'var(--color-grey-blue80)'
  } else if (division.startsWith('bronze')) {
    return BRONZE_COLOR
  } else {
    return 'var(--theme-on-surface-variant)'
  }
}

function getMostPlayedRace(player: Readonly<LadderPlayer>): RaceChar {
  const raceStats: Array<[number, RaceChar]> = [
    [player.pWins + player.pLosses, 'p'],
    [player.tWins + player.tLosses, 't'],
    [player.zWins + player.zLosses, 'z'],
    [player.rWins + player.rLosses, 'r'],
  ]
  raceStats.sort((a, b) => b[0] - a[0])
  return raceStats[0][1]
}

const TableRoot = styled.div`
  width: 100%;
  max-width: 800px;
  height: auto;
  margin: 8px auto 0px;
  padding-bottom: 16px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  contain: content;
`

const Table: TableComponents['Table'] = ({ context, ...rest }) => <TableRoot {...rest} />

const RowContainer = styled.button<{ $isEven: boolean; $isSelf: boolean }>`
  ${buttonReset};

  ${bodyLarge};
  width: 100%;
  height: 72px;
  padding: 0;

  display: flex;
  align-items: center;

  --sb-ladder-row-height: 72px;

  ${props =>
    props.$isSelf
      ? `
    background-color: rgb(from var(--color-amber60) r g b / 0.1);
    box-shadow: inset 3px 0 0 var(--theme-amber);
  `
      : ''}
`

const HEADER_STUCK_CLASS = 'sb-ladder-table-sticky-header'

const HeaderRowContainerElem = styled.div`
  ${labelMedium};
  width: 100%;
  height: 48px;
  position: sticky !important;
  top: 0;

  display: flex;
  align-items: center;

  background-color: var(--theme-container-low);
  color: var(--theme-on-surface-variant) !important;
  contain: content;

  --sb-ladder-row-height: 48px;

  .${HEADER_STUCK_CLASS} & {
    ${elevationPlus2};
    border-bottom: 1px solid var(--theme-outline-variant);
  }
`

// NOTE(tec27): This just strips the context prop off so styled-components doesn't give a warning
// about it getting passed to the DOM
function HeaderRowContainer(props: { context?: unknown }) {
  const { context: _context, ...rest } = props
  return <HeaderRowContainerElem {...rest} />
}

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
  color: var(--theme-on-surface-variant);
  text-align: right;
`

const StyledAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  margin-right: 16px;
`

const PlayerNameAndRace = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  align-items: flex-start;

  overflow: hidden;
`

const PlayerName = styled.div`
  ${titleMedium};
  ${singleLine};
  max-width: 100%;
  overflow: hidden;
`

const PlayerRace = styled.div<{ $race: RaceChar }>`
  ${labelMedium};
  color: ${props => getRaceColor(props.$race)};
`

const ErrorText = styled.div`
  ${bodyLarge};
  padding: 16px;

  color: var(--theme-error);
  text-align: center;
`

const EmptyText = styled.div`
  ${bodyLarge};
  padding: 16px;

  color: var(--theme-on-surface-variant);
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
  season: MatchmakingSeasonJson | undefined
  lastError?: Error
  searchQuery: string
  filteredDivision: DivisionFilter
  selfUserId?: SbUserId
  topNode?: React.ReactNode
  bottomNode?: React.ReactNode
}

export function LadderTable(props: LadderTableProps) {
  const [containerElem, setContainerElem] = useState<HTMLDivElement | null>(null)
  const virtuosoRef = useRef<TableVirtuosoHandle>(null)
  // Whether the user's own row (tagged with `data-self-row`) is currently within the scroll viewport,
  // used to hide the "jump to my rank" button when it's already on screen.
  const isSelfRowVisible = useTargetVisibleInScrollParent(containerElem, '[data-self-row]')

  const {
    players,
    usersById,
    lastError,
    curTime,
    season,
    searchQuery,
    filteredDivision,
    selfUserId,
    topNode,
    bottomNode,
  } = props
  const [isHeaderUnstuck, , topHeaderNode, bottomHeaderNode] = useScrollIndicatorState({
    refreshToken: players,
  })

  const bonusPool = season ? getTotalBonusPoolForSeason(new Date(curTime), season) : 0

  const onRowSelected = useCallback((userId: SbUserId, username: string) => {
    navigateToUserProfile(userId, username)
  }, [])

  const renderRow = (index: number, player: LadderPlayer) => {
    const user = usersById.get(player.userId)

    return (
      <Row
        key={player.userId}
        isEven={index % 2 === 0}
        isSelf={player.userId === selfUserId}
        player={player}
        username={user?.name ?? ''}
        avatarUrl={user?.avatarUrl}
        curTime={curTime}
        bonusPool={bonusPool}
        onSelected={onRowSelected}
      />
    )
  }
  const { t } = useTranslation()
  const emptyContent = lastError ? (
    <ErrorText>
      {t('ladder.errorRetrievingRankings', 'There was an error retrieving the current rankings.')}
    </ErrorText>
  ) : (
    <EmptyText>{t('ladder.noMatchingPlayers', 'No matching players.')}</EmptyText>
  )

  const data = useMemo(() => {
    if (
      !players ||
      filteredDivision === DivisionFilter.All ||
      !ALL_DIVISION_FILTERS.includes(filteredDivision)
    ) {
      return players
    }

    const playersWithDivs = players.map(
      p =>
        [p, ladderPlayerToMatchmakingDivision(p, bonusPool)] satisfies [
          player: LadderPlayer,
          division: MatchmakingDivision,
        ],
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
  }, [players, filteredDivision, bonusPool])

  // The podium (#1 spotlight + #2/#3 runners-up) is only meaningful for the unfiltered, full
  // rankings; while searching or filtering by division we only have/show a subset.
  const showPodium =
    !searchQuery && filteredDivision === DivisionFilter.All && (players?.length ?? 0) >= 3

  const selfIndex = selfUserId ? (data?.findIndex(p => p.userId === selfUserId) ?? -1) : -1
  const onJumpToSelf = () => {
    if (selfIndex >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: selfIndex, align: 'center' })
    }
  }

  return (
    <>
      <TableContainer ref={setContainerElem}>
        {topNode}
        {showPodium && players ? (
          <Podium>
            <SpotlightPlayer
              player={players[0]}
              username={usersById.get(players[0].userId)?.name ?? ''}
              bonusPool={bonusPool}
              onSelected={onRowSelected}
            />
            <RunnersUp>
              <RunnerUpPlayer
                place={2}
                player={players[1]}
                username={usersById.get(players[1].userId)?.name ?? ''}
                bonusPool={bonusPool}
                onSelected={onRowSelected}
              />
              <RunnerUpPlayer
                place={3}
                player={players[2]}
                username={usersById.get(players[2].userId)?.name ?? ''}
                bonusPool={bonusPool}
                onSelected={onRowSelected}
              />
            </RunnersUp>
          </Podium>
        ) : null}
        {topHeaderNode}
        {containerElem && (data?.length ?? 0) > 0 ? (
          <TableVirtuoso
            ref={virtuosoRef}
            className={isHeaderUnstuck ? '' : HEADER_STUCK_CLASS}
            customScrollParent={containerElem}
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
      {selfIndex >= 0 && data && !isSelfRowVisible ? (
        <JumpButton onClick={onJumpToSelf}>
          <MaterialIcon icon='my_location' size={20} />
          {t('ladder.jumpToMyRank', 'Jump to my rank · #{{rank}}', {
            rank: data[selfIndex].rank,
          })}
        </JumpButton>
      ) : null}
    </>
  )
}

interface PodiumPlayerProps {
  player: Readonly<LadderPlayer>
  username: string
  bonusPool: number
  onSelected: (userId: SbUserId, username: string) => void
}

// The Tooltip wraps its child in a `display: inherit` element that flex can stretch, so keep it from
// growing/shrinking the way the bare icon wouldn't.
const PodiumIconTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

function SpotlightPlayer({ player, username, bonusPool, onSelected }: PodiumPlayerProps) {
  const { t } = useTranslation()
  const division = ladderPlayerToMatchmakingDivision(player, bonusPool)
  const divisionLabel = matchmakingDivisionToLabel(division, t)
  const race = getMostPlayedRace(player)
  const isRated = player.lifetimeGames >= NUM_PLACEMENT_MATCHES

  return (
    <SpotlightCard onClick={() => onSelected(player.userId, username)}>
      <SpotlightRank>#1</SpotlightRank>
      <PodiumIconTooltip text={divisionLabel} position='bottom'>
        <SpotlightIcon player={player} bonusPool={bonusPool} size={64} />
      </PodiumIconTooltip>
      <SpotlightInfo>
        <SpotlightName>{username}</SpotlightName>
        <SpotlightMeta>
          <RaceBadge $race={race} title={raceCharToLabel(race, t)}>
            {race.toUpperCase()}
          </RaceBadge>
          <DivisionLabelText $color={getDivisionColor(division)}>{divisionLabel}</DivisionLabelText>
          <span>
            · {player.wins} &ndash; {player.losses}
          </span>
        </SpotlightMeta>
      </SpotlightInfo>
      <FlexSpacer />
      <SpotlightPoints>
        <SpotlightPointsValue>
          {Math.round(player.points).toLocaleString()}{' '}
          <SpotlightPointsLabel>{t('ladder.pointsAbbrev', 'pts')}</SpotlightPointsLabel>
        </SpotlightPointsValue>
        {isRated ? (
          <SpotlightMmr>
            {t('ladder.mmrValue', '{{mmr}} MMR', {
              mmr: Math.round(player.rating).toLocaleString(),
            })}
          </SpotlightMmr>
        ) : null}
      </SpotlightPoints>
    </SpotlightCard>
  )
}

const MEDAL_COLORS = ['var(--color-amber60)', 'var(--color-grey-blue80)', BRONZE_COLOR]

function RunnerUpPlayer({
  place,
  player,
  username,
  bonusPool,
  onSelected,
}: PodiumPlayerProps & { place: number }) {
  const { t } = useTranslation()
  const division = ladderPlayerToMatchmakingDivision(player, bonusPool)
  const divisionLabel = matchmakingDivisionToLabel(division, t)
  const medalColor = MEDAL_COLORS[place - 1] ?? MEDAL_COLORS[2]
  const isRated = player.lifetimeGames >= NUM_PLACEMENT_MATCHES

  return (
    <RunnerUpCard $medalColor={medalColor} onClick={() => onSelected(player.userId, username)}>
      <RunnerUpRank $medalColor={medalColor}>#{place}</RunnerUpRank>
      <PodiumIconTooltip text={divisionLabel} position='bottom'>
        <RunnerUpIcon player={player} bonusPool={bonusPool} size={44} />
      </PodiumIconTooltip>
      <RunnerUpInfo>
        <RunnerUpName>{username}</RunnerUpName>
        <DivisionLabelText $color={getDivisionColor(division)}>{divisionLabel}</DivisionLabelText>
      </RunnerUpInfo>
      <RunnerUpPoints>
        <RunnerUpPointsValue>{Math.round(player.points).toLocaleString()}</RunnerUpPointsValue>
        {isRated ? (
          <RunnerUpMmr>
            {t('ladder.mmrValue', '{{mmr}} MMR', {
              mmr: Math.round(player.rating).toLocaleString(),
            })}
          </RunnerUpMmr>
        ) : null}
      </RunnerUpPoints>
    </RunnerUpCard>
  )
}

const Header = () => {
  const { t } = useTranslation()
  return (
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
}

// TODO(2Pac): react-virtuoso types expect the `ref` here to point to a `tbody` element. I opened an
// issue on their github page: https://github.com/petyosi/react-virtuoso/issues/644
const TableBody = ({
  context,
  ...rest
}: TableBodyProps &
  ContextProp<unknown> & {
    ref?: React.Ref<HTMLTableSectionElement>
    style?: React.CSSProperties
    className?: string
  }) => <div {...rest} />

const TableRow: TableComponents<any, any>['TableRow'] = ({ context, item, ...rest }) => {
  return <div {...rest} />
}

const FillerRow = styled.div.attrs<{ height: number }>(props => ({
  style: { height: `${props.height}px` },
}))<{ height: number }>``

const UnratedText = styled.span`
  color: var(--theme-on-surface-variant);
`

const DivisionIcon = styled(LadderPlayerIcon)`
  width: 44px;
  height: 44px;
`

interface RowProps {
  isEven: boolean
  isSelf: boolean
  player: LadderPlayer
  username: string
  avatarUrl?: string
  curTime: number
  bonusPool: number
  onSelected?: (userId: SbUserId, username: string) => void
}

const Row = React.memo(
  ({ isEven, isSelf, player, username, avatarUrl, curTime, bonusPool, onSelected }: RowProps) => {
    const { t } = useTranslation()
    const onClick = useCallback(() => {
      if (onSelected) {
        onSelected(player.userId, username)
      }
    }, [onSelected, player, username])
    const [buttonProps, rippleRef] = useButtonState({ onClick })

    const mostPlayedRace = getMostPlayedRace(player)

    const division = ladderPlayerToMatchmakingDivision(player, bonusPool)
    const divisionLabel = matchmakingDivisionToLabel(division, t)

    return (
      <RowContainer
        $isEven={isEven}
        $isSelf={isSelf}
        data-self-row={isSelf || undefined}
        {...buttonProps}>
        <RankCell>
          <Tooltip text={divisionLabel} position='bottom'>
            <DivisionIcon player={player} bonusPool={bonusPool} size={44} />
          </Tooltip>
          <span>{player.rank}</span>
        </RankCell>
        <PlayerCell>
          <StyledAvatar user={username} image={avatarUrl} />
          <PlayerNameAndRace>
            <PlayerName>{username}</PlayerName>
            <PlayerRace $race={mostPlayedRace}>{raceCharToLabel(mostPlayedRace, t)}</PlayerRace>
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
  },
)
