import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  getTotalBonusPoolForSeason,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { LadderPlayerIcon } from '../matchmaking/rank-icon'
import { bodyLarge, labelMedium, singleLine, titleLarge, titleMedium } from '../styles/typography'

const RankDisplayRoot = styled.div`
  padding: 16px 16px 8px;

  display: flex;

  background-color: var(--theme-container-low);
  border-radius: 4px;
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

const RankDisplayType = styled.div`
  ${titleMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const RankDisplayInfo = styled.div`
  padding-left: 8px;

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

const RankDisplayPrefix = styled.span`
  ${labelMedium};
`

export function UserRankDisplay({
  matchmakingType,
  ladderPlayer,
  season,
}: {
  matchmakingType: MatchmakingType
  ladderPlayer: LadderPlayer
  season: ReadonlyDeep<MatchmakingSeasonJson>
}) {
  const { t } = useTranslation()
  const bonusPool = getTotalBonusPoolForSeason(new Date(), season)
  const division = ladderPlayerToMatchmakingDivision(ladderPlayer, bonusPool)

  if (division === MatchmakingDivision.Unrated) {
    return null
  }

  const divisionLabel = matchmakingDivisionToLabel(division, t)

  return (
    <RankDisplayRoot>
      <DivisionInfo>
        <DivisionIcon player={ladderPlayer} size={88} bonusPool={bonusPool} />
        <RankDisplayDivisionLabel>{divisionLabel}</RankDisplayDivisionLabel>
        <RankDisplayType>{matchmakingTypeToLabel(matchmakingType, t)}</RankDisplayType>
      </DivisionInfo>
      <RankDisplayInfo>
        <RankDisplayInfoRow>
          <RankDisplayInfoEntry>
            <RankDisplayInfoValue>
              <RankDisplayPrefix>#</RankDisplayPrefix>
              {ladderPlayer.rank}
            </RankDisplayInfoValue>
            <RankDisplayInfoLabel>{t('users.profile.rank', 'Rank')}</RankDisplayInfoLabel>
          </RankDisplayInfoEntry>
          <RankDisplayInfoEntry>
            <RankDisplayInfoValue>{Math.round(ladderPlayer.points)}</RankDisplayInfoValue>
            <RankDisplayInfoLabel>{t('users.profile.points', 'Points')}</RankDisplayInfoLabel>
          </RankDisplayInfoEntry>
        </RankDisplayInfoRow>
        <RankDisplayInfoRow>
          <RankDisplayInfoEntry>
            <RankDisplayInfoValue>
              {ladderPlayer.wins} &ndash; {ladderPlayer.losses}
            </RankDisplayInfoValue>
            <RankDisplayInfoLabel>{t('users.profile.record', 'Record')}</RankDisplayInfoLabel>
          </RankDisplayInfoEntry>
          <RankDisplayInfoEntry>
            <RankDisplayInfoValue>{Math.round(ladderPlayer.rating)}</RankDisplayInfoValue>
            <RankDisplayInfoLabel>{t('users.profile.rating', 'Rating')}</RankDisplayInfoLabel>
          </RankDisplayInfoEntry>
        </RankDisplayInfoRow>
      </RankDisplayInfo>
    </RankDisplayRoot>
  )
}
