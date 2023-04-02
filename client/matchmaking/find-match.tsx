import { Immutable } from 'immer'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder'
import {
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingPreferences,
  MatchmakingType,
  matchmakingTypeToLabel,
  MATCHMAKING_BONUS_EARNED_PER_MS,
  NUM_PLACEMENT_MATCHES,
} from '../../common/matchmaking'
import { closeOverlay } from '../activities/action-creators'
import { DisabledOverlay } from '../activities/disabled-content'
import { useSelfUser } from '../auth/state-hooks'
import { ComingSoon } from '../coming-soon/coming-soon'
import { useKeyListener } from '../keyboard/key-listener'
import { getInstantaneousSelfRank } from '../ladder/action-creators'
import { RaisedButton } from '../material/button'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { findMatchAsParty } from '../parties/action-creators'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  amberA400,
  background600,
  colorDividers,
  colorError,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import {
  body1,
  caption,
  headline5,
  Headline5,
  headline6,
  singleLine,
  subtitle1,
} from '../styles/typography'
import { findMatch, getCurrentMapPool, updateLastQueuedMatchmakingType } from './action-creators'
import { Contents1v1 } from './find-1v1'
import { Contents2v2 } from './find-2v2'
import { FindMatchFormRef } from './find-match-forms'
import {
  ConnectedMatchmakingDisabledCard,
  ConnectedPartyDisabledCard,
} from './matchmaking-disabled-card'
import { LadderPlayerIcon } from './rank-icon'
import { useTranslation } from 'react-i18next'

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

interface DisabledContentsProps {
  matchmakingType: MatchmakingType
  isMatchmakingStatusDisabled: boolean
  isMatchmakingPartyDisabled: boolean
}

function DisabledContents(props: DisabledContentsProps) {
  const { matchmakingType, isMatchmakingStatusDisabled, isMatchmakingPartyDisabled } = props

  if (isMatchmakingStatusDisabled) {
    return (
      <DisabledOverlay>
        <ConnectedMatchmakingDisabledCard type={matchmakingType} />
      </DisabledOverlay>
    )
  } else if (isMatchmakingPartyDisabled) {
    return (
      <DisabledOverlay>
        <ConnectedPartyDisabledCard type={matchmakingType} />
      </DisabledOverlay>
    )
  }

  return null
}

// TODO(tec27): Remove this once 3v3 is added as a "real" matchmaking type
type ExpandedMatchmakingType = MatchmakingType | '3v3'

export function FindMatch() {
  const lastQueuedMatchmakingType = useAppSelector(
    s => s.matchmakingPreferences.lastQueuedMatchmakingType,
  )
  const [activeTab, setActiveTab] = useState(lastQueuedMatchmakingType as ExpandedMatchmakingType)

  const dispatch = useAppDispatch()
  const isMatchmakingStatusDisabled = !useAppSelector(
    s => s.matchmakingStatus.byType.get(activeTab as MatchmakingType)?.enabled ?? false,
  )
  const selfUser = useSelfUser()!
  const partyId = useAppSelector(s => s.party.current?.id)
  const isInParty = !!partyId
  const partySize = useAppSelector(s => s.party.current?.members.length ?? 0)
  const isPartyLeader = useAppSelector(s => s.party.current?.leader === selfUser.id)
  const isMatchmakingPartyDisabled =
    isInParty &&
    (!isPartyLeader ||
      (activeTab === MatchmakingType.Match1v1 && partySize > 1) ||
      (activeTab === MatchmakingType.Match2v2 && partySize > 2))

  const isMatchmakingDisabled = isMatchmakingStatusDisabled || isMatchmakingPartyDisabled

  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState({
    refreshToken: activeTab,
  })
  const formRef = useRef<FindMatchFormRef>(null)

  const onTabChange = useCallback(
    (tab: ExpandedMatchmakingType) => {
      if (tab !== '3v3') {
        dispatch(updateLastQueuedMatchmakingType(tab))
      }

      setActiveTab(tab)
    },
    [dispatch],
  )

  const onSubmit = useCallback(
    (prefs: Immutable<MatchmakingPreferences>) => {
      if (activeTab === '3v3') {
        return
      }

      if (isInParty) {
        dispatch(findMatchAsParty(activeTab, prefs, partyId))
      } else {
        dispatch(findMatch(activeTab, prefs))
      }
      dispatch(closeOverlay() as any)
    },
    [activeTab, dispatch, isInParty, partyId],
  )

  const onFindClick = useCallback(() => {
    formRef.current?.submit()
  }, [])

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
  const { t } = useTranslation()
  return (
    <Container>
      <TitleBar>
        <Headline5>{t('matchmaking.findMatch.findMatchHeader', 'Find match')}</Headline5>
        <TabArea>
          <Tabs activeTab={activeTab} onChange={onTabChange}>
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match1v1)}
              value={MatchmakingType.Match1v1}
            />
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match2v2)}
              value={MatchmakingType.Match2v2}
            />
            <TabItem text={'3v3'} value={'3v3'} />
          </Tabs>
        </TabArea>
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </TitleBar>

      {contents ? (
        <>
          <Contents $disabled={isMatchmakingDisabled}>
            {topElem}
            <ContentsBody>
              <RankInfo matchmakingType={activeTab as MatchmakingType} />
              {contents}
            </ContentsBody>
            {bottomElem}
            <DisabledContents
              matchmakingType={activeTab as MatchmakingType}
              isMatchmakingStatusDisabled={isMatchmakingStatusDisabled}
              isMatchmakingPartyDisabled={isMatchmakingPartyDisabled}
            />
          </Contents>
          <Actions>
            <ScrollDivider $show={!isAtBottom} $showAt='top' />
            <RaisedButton
              label={t('matchmaking.findMatch.findMatchLabel', 'Find match')}
              disabled={isMatchmakingDisabled}
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

  background-color: ${background600};
  border-radius: 4px;
`

const RankLoadingError = styled.div`
  ${body1};
  color: ${colorError};
`

const DivisionInfo = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  border-right: 1px solid ${colorDividers};
  padding-right: 15px;
`

const DivisionIcon = styled(LadderPlayerIcon)`
  width: 88px;
  height: 88px;
`

const RankDisplayDivisionLabel = styled.div`
  ${headline6};
  padding-top: 12px;
`

const RankDisplayInfo = styled.div`
  padding-left: 24px;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;

  color: ${colorTextSecondary};
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
  ${caption};
  ${singleLine};
  color: ${colorTextFaint};
`

const RankDisplayInfoValue = styled.div`
  ${subtitle1};
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

  border: 2px solid ${colorDividers};
  border-radius: 9999px;
  contain: paint;

  &::after {
    position: absolute;
    content: '';
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    background-color: ${amberA400};
    transform: scaleX(var(--sb-bonus-bar-scale, 0));
    transform-origin: 0% 50%;
  }
`

const UnratedText = styled.div`
  ${headline5};
  text-align: center;
`

const BONUS_PER_WEEK = Math.floor(MATCHMAKING_BONUS_EARNED_PER_MS * 1000 * 60 * 60 * 24 * 7)

function RankInfo({ matchmakingType }: { matchmakingType: MatchmakingType }) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const selfUserId = selfUser.id
  const [loadingError, setLoadingError] = useState<Error>()
  const { t } = useTranslation()
  const season = useAppSelector(s => s.selfRank.currentSeason)
  const ladderPlayer = useAppSelector<Readonly<LadderPlayer>>(
    s =>
      s.selfRank.byType.get(matchmakingType) ?? {
        rank: Number.MAX_SAFE_INTEGER,
        userId: selfUserId,
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
      },
  )

  const bonusPoolSize = useMemo(() => {
    if (!season) {
      return 0
    }

    return (Date.now() - season.startDate) * MATCHMAKING_BONUS_EARNED_PER_MS
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
        <RankLoadingError>{t('matchmaking.findMatch.errorLoadingRank', 'There was a problem loading your current rank.')}</RankLoadingError>
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

  const division = ladderPlayerToMatchmakingDivision(ladderPlayer)

  const bonusAvailable = Math.max(0, Math.floor(bonusPoolSize - ladderPlayer.bonusUsed))
  const bonusScale = Math.min(bonusAvailable / BONUS_PER_WEEK, 1)

  return (
    <RankInfoContainer>
      <DivisionInfo>
        <DivisionIcon player={ladderPlayer} size={88} />
        <RankDisplayDivisionLabel>{matchmakingDivisionToLabel(division)}</RankDisplayDivisionLabel>
      </DivisionInfo>

      <RankDisplayInfo>
        {division !== MatchmakingDivision.Unrated ? (
          <>
            <RankDisplayInfoRow>
              <Tooltip text={`${bonusAvailable} points`} position='top'>
                <BonusBarEntry>
                  <BonusBar style={{ '--sb-bonus-bar-scale': bonusScale } as any} />
                  <RankDisplayInfoLabel>{t('matchmaking.findMatch.bonusPoolLabel', 'Bonus pool')}</RankDisplayInfoLabel>
                </BonusBarEntry>
              </Tooltip>
            </RankDisplayInfoRow>
            <RankDisplayInfoRow>
              <RankDisplayInfoEntry>
                <RankDisplayInfoValue>{Math.round(ladderPlayer.points)}</RankDisplayInfoValue>
                <RankDisplayInfoLabel>{t('matchmaking.findMatch.pointsLabel', 'Points')}</RankDisplayInfoLabel>
              </RankDisplayInfoEntry>
              <RankDisplayInfoEntry>
                <RankDisplayInfoValue>{Math.round(ladderPlayer.rating)}</RankDisplayInfoValue>
                <RankDisplayInfoLabel>{t('matchmaking.findMatch.ratingLabel', 'Rating')}</RankDisplayInfoLabel>
              </RankDisplayInfoEntry>
            </RankDisplayInfoRow>
          </>
        ) : (
          <UnratedText>
            {ladderPlayer.lifetimeGames} / {NUM_PLACEMENT_MATCHES} {t('matchmaking.findMatch.placementsLabel', 'placements')}
          </UnratedText>
        )}
      </RankDisplayInfo>
    </RankInfoContainer>
  )
}
