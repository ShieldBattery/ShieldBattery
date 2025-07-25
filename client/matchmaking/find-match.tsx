import { Immutable } from 'immer'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  MATCHMAKING_BONUS_EARNED_PER_MS,
  MatchmakingDivision,
  MatchmakingPreferences,
  MatchmakingType,
  getTotalBonusPoolForSeason,
  makeSeasonId,
  matchmakingDivisionToLabel,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { urlPath } from '../../common/urls'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { ComingSoon } from '../coming-soon/coming-soon'
import { useKeyListener } from '../keyboard/key-listener'
import { getInstantaneousSelfRank } from '../ladder/action-creators'
import { FilledButton } from '../material/button'
import { Card } from '../material/card'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { elevationPlus3 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { healthChecked } from '../starcraft/health-checked'
import {
  BodyLarge,
  TitleLarge,
  bodyLarge,
  bodyMedium,
  labelMedium,
  singleLine,
  titleLarge,
} from '../styles/typography'
import { findMatch, getCurrentMapPool } from './action-creators'
import { Contents1v1 } from './find-1v1'
import { Contents1v1Fastest } from './find-1v1-fastest'
import { Contents2v2 } from './find-2v2'
import { FindMatchFormRef } from './find-match-forms'
import { ConnectedMatchmakingDisabledCard } from './matchmaking-disabled-card'
import { LadderPlayerIcon } from './rank-icon'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TitleBar = styled.div`
  position: relative;
  padding: 16px 24px;
  display: flex;
  flex-direction: row;
  align-items: center;
`

const Contents = styled.div<{ $disabled: boolean }>`
  position: relative;
  flex-grow: 1;
  overflow-y: ${props => (props.$disabled ? 'hidden' : 'auto')};
  contain: strict;
  pointer-events: ${props => (props.$disabled ? 'none' : 'auto')};
`

const ContentsBody = styled.div`
  padding: 0px 24px 12px;
`

const Actions = styled.div`
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 16px 24px;
  contain: content;
`

const TabArea = styled.div`
  min-width: 312px;
  margin-left: 24px;
  flex-shrink: 0;
`

const DisabledOverlay = styled.div`
  position: absolute;
  inset: 0;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  contain: strict;
  pointer-events: auto;
  z-index: 100;

  &:before {
    content: '';
    position: absolute;
    inset: 0;

    background-color: var(--theme-dialog-scrim);
    opacity: var(--theme-dialog-scrim-opacity);

    z-index: -1;
  }
`

const InLobbyCard = styled(Card)`
  ${elevationPlus3};

  position: relative;
  width: 480px;
  padding: 24px;
  gap: 32px;

  display: flex;
  flex-direction: column;
  align-items: center;
`

interface DisabledContentsProps {
  matchmakingType: MatchmakingType
  isMatchmakingDisabled: boolean
  isInLobby: boolean
}

function DisabledContents({
  matchmakingType,
  isMatchmakingDisabled,
  isInLobby,
}: DisabledContentsProps) {
  const { t } = useTranslation()
  const lobbyName = useAppSelector(s => s.lobby.info.name)

  if (isInLobby) {
    return (
      <DisabledOverlay>
        <InLobbyCard>
          <BodyLarge>
            {t(
              'matchmaking.findMatch.lobbyDisabledText',
              "You can't use matchmaking while in a lobby.",
            )}
          </BodyLarge>
          <FilledButton
            label={t('matchmaking.findMatch.goToLobby', 'Go to lobby')}
            onClick={() => {
              push(urlPath`/lobbies/${lobbyName}`)
            }}
          />
        </InLobbyCard>
      </DisabledOverlay>
    )
  } else if (isMatchmakingDisabled) {
    return (
      <DisabledOverlay>
        <ConnectedMatchmakingDisabledCard type={matchmakingType} />
      </DisabledOverlay>
    )
  } else {
    return null
  }
}

// TODO(tec27): Remove this once 3v3 is added as a "real" matchmaking type
type ExpandedMatchmakingType = MatchmakingType | '3v3'

function normalizeExpandedMatchmakingType(type?: string): ExpandedMatchmakingType {
  switch (type) {
    case MatchmakingType.Match1v1:
    case MatchmakingType.Match1v1Fastest:
    case MatchmakingType.Match2v2:
    case '3v3':
      return type
    default:
      return MatchmakingType.Match1v1
  }
}

export function FindMatch() {
  const { t } = useTranslation()
  const [storedLastActiveTab, setLastActiveTab] = useUserLocalStorageValue<ExpandedMatchmakingType>(
    'matchmaking.findMatch.lastActiveTab',
  )
  const lastActiveTab = normalizeExpandedMatchmakingType(storedLastActiveTab)
  const [activeTab, setActiveTab] = useState(lastActiveTab)
  useTrackPageView(urlPath`/matchmaking/find/${activeTab}`)

  const dispatch = useAppDispatch()
  const isMatchmakingDisabled = !useAppSelector(
    s => s.matchmakingStatus.byType.get(activeTab as MatchmakingType)?.enabled ?? false,
  )
  const inLobby = useAppSelector(s => s.lobby.inLobby)

  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState({
    refreshToken: activeTab,
  })
  const formRef = useRef<FindMatchFormRef>(null)

  const onSubmit = healthChecked((prefs: Immutable<MatchmakingPreferences>) => {
    if (activeTab === '3v3') {
      return
    }

    dispatch(findMatch(activeTab, prefs))
  })

  const onFindClick = () => {
    formRef.current?.submit()
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onFindClick()
        return true
      }

      return false
    },
  })

  useEffect(() => {
    if (activeTab !== '3v3') {
      dispatch(getCurrentMapPool(activeTab))
    }
  }, [activeTab, dispatch])

  let contents: React.ReactNode | undefined
  switch (activeTab) {
    case MatchmakingType.Match1v1:
      contents = (
        <Contents1v1 formRef={formRef} onSubmit={onSubmit} disabled={isMatchmakingDisabled} />
      )
      break
    case MatchmakingType.Match1v1Fastest:
      contents = (
        <Contents1v1Fastest
          formRef={formRef}
          onSubmit={onSubmit}
          disabled={isMatchmakingDisabled}
        />
      )
      break
    case MatchmakingType.Match2v2:
      contents = (
        <Contents2v2 formRef={formRef} onSubmit={onSubmit} disabled={isMatchmakingDisabled} />
      )
      break
    case '3v3':
      // TODO(tec27): Build UIs for these
      contents = undefined
      break
    default:
      contents = assertUnreachable(activeTab)
  }

  const disabled = isMatchmakingDisabled || inLobby

  return (
    <Container>
      <TitleBar>
        <TitleLarge>{t('matchmaking.findMatch.title', 'Find match')}</TitleLarge>
        <TabArea>
          <Tabs
            activeTab={activeTab}
            onChange={(tab: ExpandedMatchmakingType) => {
              setLastActiveTab(tab)
              setActiveTab(tab)
            }}>
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match1v1, t)}
              value={MatchmakingType.Match1v1}
            />
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match1v1Fastest, t)}
              value={MatchmakingType.Match1v1Fastest}
            />
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match2v2, t)}
              value={MatchmakingType.Match2v2}
            />
            <TabItem text={t('matchmaking.type.3v3', '3v3')} value={'3v3'} />
          </Tabs>
        </TabArea>
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </TitleBar>

      {contents ? (
        <>
          <Contents $disabled={disabled}>
            {topElem}
            <ContentsBody>
              <RankInfo matchmakingType={activeTab as MatchmakingType} />
              {contents}
            </ContentsBody>
            {bottomElem}
            <DisabledContents
              matchmakingType={activeTab as MatchmakingType}
              isMatchmakingDisabled={isMatchmakingDisabled}
              isInLobby={inLobby}
            />
          </Contents>
          <Actions>
            <ScrollDivider $show={!isAtBottom} $showAt='top' />
            <FilledButton
              label={t('matchmaking.findMatch.action', 'Find match')}
              disabled={disabled}
              onClick={onFindClick}
            />
          </Actions>
        </>
      ) : (
        <Contents $disabled={false}>
          <ContentsBody>
            <ComingSoon />
          </ContentsBody>
        </Contents>
      )}
    </Container>
  )
}

const RankInfoContainer = styled.div`
  max-width: 408px;
  height: 160px;

  padding: 16px;
  margin-bottom: 16px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-container-low);
  border-radius: 4px;
`

const RankLoadingError = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

const DivisionInfo = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  border-right: 1px solid var(--theme-outline-variant);
  padding-right: 15px;
`

const DivisionIcon = styled(LadderPlayerIcon)`
  width: 88px;
  height: 88px;
`

const RankDisplayDivisionLabel = styled.div`
  ${titleLarge};
  padding-top: 12px;
`

const RankDisplayInfo = styled.div`
  padding-left: 24px;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;

  color: var(--theme-on-surface);
`

const RankDisplayInfoRow = styled.div`
  height: 44px;
  display: flex;
  gap: 8px;
`

const RankDisplayInfoEntry = styled.div`
  width: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
`

const RankDisplayInfoLabel = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const RankDisplayInfoValue = styled.div`
  ${bodyLarge};
  ${singleLine};
`

const BonusBarEntry = styled(RankDisplayInfoEntry)`
  width: calc(96px + 96px + 24px);
`

const BonusBar = styled.div`
  position: relative;
  width: 100%;
  height: 20px;
  margin: 2px 0;

  border: 2px solid var(--theme-outline-variant);
  border-radius: 9999px;
  contain: paint;

  &::after {
    position: absolute;
    content: '';
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    background-color: var(--theme-amber);
    transform: scaleX(var(--sb-bonus-bar-scale, 0));
    transform-origin: 0% 50%;
  }
`

const UnratedText = styled.div`
  ${titleLarge};
  text-align: center;
`

const BONUS_PER_WEEK = Math.floor(MATCHMAKING_BONUS_EARNED_PER_MS * 1000 * 60 * 60 * 24 * 7)

function RankInfo({ matchmakingType }: { matchmakingType: MatchmakingType }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const selfUserId = selfUser.id
  const [loadingError, setLoadingError] = useState<Error>()

  const season = useAppSelector(s => s.selfRank.currentSeason)
  const ladderPlayer =
    useAppSelector(s => s.selfRank.byType.get(matchmakingType)) ??
    ({
      rank: Number.MAX_SAFE_INTEGER,
      userId: selfUserId,
      matchmakingType,
      seasonId: season?.id ?? makeSeasonId(0),
      rating: 0,
      points: 0,
      bonusUsed: 0,
      lifetimeGames: 0,
      wins: 0,
      losses: 0,
      lastPlayedDate: 0,

      pWins: 0,
      pLosses: 0,
      tWins: 0,
      tLosses: 0,
      zWins: 0,
      zLosses: 0,
      rWins: 0,
      rLosses: 0,

      rPWins: 0,
      rPLosses: 0,
      rTWins: 0,
      rTLosses: 0,
      rZWins: 0,
      rZLosses: 0,
    } satisfies LadderPlayer)

  const bonusPoolSize = useMemo(() => {
    if (!season) {
      return 0
    }

    return getTotalBonusPoolForSeason(new Date(), season)
  }, [season])

  useEffect(() => {
    const abortController = new AbortController()

    dispatch(
      getInstantaneousSelfRank({
        signal: abortController.signal,
        onSuccess: () => {
          setLoadingError(undefined)
        },
        onError: err => {
          setLoadingError(err)
        },
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [dispatch, selfUserId])

  if (loadingError) {
    return (
      <RankInfoContainer>
        <RankLoadingError>
          {t(
            'matchmaking.findMatch.errors.loadingRank',
            'There was a problem loading your current rank.',
          )}
        </RankLoadingError>
      </RankInfoContainer>
    )
  }
  if (!season) {
    return (
      <RankInfoContainer>
        <LoadingDotsArea />
      </RankInfoContainer>
    )
  }

  const division = ladderPlayerToMatchmakingDivision(ladderPlayer, bonusPoolSize)

  const bonusAvailable = Math.max(0, Math.floor(bonusPoolSize - ladderPlayer.bonusUsed))
  const bonusScale = Math.min(bonusAvailable / BONUS_PER_WEEK, 1)

  return (
    <RankInfoContainer>
      <DivisionInfo>
        <DivisionIcon player={ladderPlayer} bonusPool={bonusPoolSize} size={88} />
        <RankDisplayDivisionLabel>
          {matchmakingDivisionToLabel(division, t)}
        </RankDisplayDivisionLabel>
      </DivisionInfo>

      <RankDisplayInfo>
        {division !== MatchmakingDivision.Unrated ? (
          <>
            <RankDisplayInfoRow>
              <Tooltip
                text={t('matchmaking.findMatch.bonusPoints', {
                  defaultValue: '{{bonusAvailable}} points',
                  bonusAvailable,
                })}
                position='top'>
                <BonusBarEntry>
                  <BonusBar style={{ '--sb-bonus-bar-scale': bonusScale } as any} />
                  <RankDisplayInfoLabel>
                    {t('matchmaking.findMatch.bonusPool', 'Bonus pool')}
                  </RankDisplayInfoLabel>
                </BonusBarEntry>
              </Tooltip>
            </RankDisplayInfoRow>
            <RankDisplayInfoRow>
              <RankDisplayInfoEntry>
                <RankDisplayInfoValue>{Math.round(ladderPlayer.points)}</RankDisplayInfoValue>
                <RankDisplayInfoLabel>
                  {t('matchmaking.findMatch.points', 'Points')}
                </RankDisplayInfoLabel>
              </RankDisplayInfoEntry>
              <RankDisplayInfoEntry>
                <RankDisplayInfoValue>{Math.round(ladderPlayer.rating)}</RankDisplayInfoValue>
                <RankDisplayInfoLabel>
                  {t('matchmaking.findMatch.rating', 'Rating')}
                </RankDisplayInfoLabel>
              </RankDisplayInfoEntry>
            </RankDisplayInfoRow>
          </>
        ) : (
          <UnratedText>{t('matchmaking.findMatch.unratedText', 'No rating')}</UnratedText>
        )}
      </RankDisplayInfo>
    </RankInfoContainer>
  )
}
