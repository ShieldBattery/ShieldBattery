import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { ClientLeagueUserJson } from '../../common/leagues/leagues'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { ConnectedAvatar } from '../avatars/avatar'
import { buttonReset } from '../material/button-reset'
import { elevationPlus1 } from '../material/shadows'
import { useAppSelector } from '../redux-hooks'
import { getRaceColor } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import {
  bodyMedium,
  labelLarge,
  labelMedium,
  singleLine,
  sofiaSansCondensed,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { navigateToUserProfile } from '../users/action-creators'
import { ConnectedUsername } from '../users/connected-username'
import { RaceSelectionTooltip } from '../users/race-selection-tooltip'
const STACKED_LAYOUT_BELOW_PX = 680
const NARROW_LAYOUT_BELOW_PX = 440
const Podium = styled.div`
  width: 100%;
  margin: 16px auto 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`
const RunnersUp = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  @container ladder-content (width < ${STACKED_LAYOUT_BELOW_PX}px) {
    grid-template-columns: 1fr;
  }
`
/**
 * The #1 player's card. It has two layouts: a single row of rank, icon, name and point total at
 * normal widths, and at narrow widths a grid that moves the points onto a second row underneath the
 * name, so the name keeps the card's width instead of being squeezed by the points beside it.
 */
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
  @container ladder-content (width < ${NARROW_LAYOUT_BELOW_PX}px) {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    grid-template-areas:
      'rank icon info'
      '. . points';
    gap: 8px 12px;
    padding: 14px 16px;
  }
`
const SpotlightRank = styled.div`
  ${sofiaSansCondensed};
  flex-shrink: 0;
  grid-area: rank;
  color: var(--theme-amber);
  font-size: 54px;
  line-height: 1;
  @container ladder-content (width < ${NARROW_LAYOUT_BELOW_PX}px) {
    font-size: 40px;
  }
`
const SpotlightIcon = styled(ConnectedAvatar)`
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  @container ladder-content (width < ${NARROW_LAYOUT_BELOW_PX}px) {
    width: 48px;
    height: 48px;
  }
`
const SpotlightInfo = styled.div`
  min-width: 0;
  flex-grow: 1;
  grid-area: info;
`
/* Every child of the grid layout is placed by area, so an auto-placed spacer would claim a cell. */
const SpotlightSpacer = styled(FlexSpacer)`
  @container ladder-content (width < ${NARROW_LAYOUT_BELOW_PX}px) {
    display: none;
  }
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
  grid-area: points;
  text-align: right;
  @container ladder-content (width < ${NARROW_LAYOUT_BELOW_PX}px) {
    display: flex;
    align-items: baseline;
    gap: 12px;
    text-align: left;
  }
`
const SpotlightPointsValue = styled.div`
  ${sofiaSansCondensed};
  color: var(--theme-amber);
  font-size: 38px;
  line-height: 1;
  @container ladder-content (width < ${NARROW_LAYOUT_BELOW_PX}px) {
    font-size: 28px;
  }
`
const SpotlightPointsLabel = styled.span`
  ${labelLarge};
  color: var(--color-amber70);
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
const RunnerUpIcon = styled(ConnectedAvatar)`
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
const RaceBadge = styled.span<{ $race: RaceChar }>`
  ${labelMedium};
  color: ${props => getRaceColor(props.$race)};
`
export function LeaguePodium({
  entries,
}: {
  entries: ReadonlyArray<{ rank: number; leagueUser: ReadonlyDeep<ClientLeagueUserJson> }>
}) {
  const { t } = useTranslation()
  const users = useAppSelector(s => s.users.byId)
  const cards = entries.slice(0, 3).map(({ rank, leagueUser }, index) => {
    const race = (['p', 't', 'z', 'r'] as RaceChar[]).sort(
      (a, b) =>
        leagueUser[`${b}Wins`] +
        leagueUser[`${b}Losses`] -
        (leagueUser[`${a}Wins`] + leagueUser[`${a}Losses`]),
    )[0]
    const raceBadge = (
      <RaceSelectionTooltip stats={leagueUser}>
        <RaceBadge $race={race}>{raceCharToLabel(race, t)}</RaceBadge>
      </RaceSelectionTooltip>
    )
    const record = `${leagueUser.wins} – ${leagueUser.losses}`
    const onClick = () =>
      navigateToUserProfile(leagueUser.userId, users.get(leagueUser.userId)?.name ?? '_')
    return index === 0 ? (
      <SpotlightCard key={leagueUser.userId} onClick={onClick}>
        <SpotlightRank>#{rank}</SpotlightRank>
        <SpotlightIcon userId={leagueUser.userId} />
        <SpotlightInfo>
          <SpotlightName>
            <ConnectedUsername interactive={false} userId={leagueUser.userId} />
          </SpotlightName>
          <SpotlightMeta>
            {raceBadge}
            <span>{record}</span>
          </SpotlightMeta>
        </SpotlightInfo>
        <SpotlightSpacer />
        <SpotlightPoints>
          <SpotlightPointsValue>{Math.round(leagueUser.points)}</SpotlightPointsValue>
          <SpotlightPointsLabel>{t('ladder.points', 'Points')}</SpotlightPointsLabel>
        </SpotlightPoints>
      </SpotlightCard>
    ) : (
      <RunnerUpCard
        key={leagueUser.userId}
        $medalColor={index === 1 ? 'var(--color-grey80)' : '#cf9069'}
        onClick={onClick}>
        <RunnerUpRank $medalColor={index === 1 ? 'var(--color-grey80)' : '#cf9069'}>
          #{rank}
        </RunnerUpRank>
        <RunnerUpIcon userId={leagueUser.userId} />
        <RunnerUpInfo>
          <RunnerUpName>
            <ConnectedUsername interactive={false} userId={leagueUser.userId} />
          </RunnerUpName>
          <SpotlightMeta>
            {raceBadge}
            <span>{record}</span>
          </SpotlightMeta>
        </RunnerUpInfo>
        <RunnerUpPoints>
          <RunnerUpPointsValue>
            {Math.round(leagueUser.points)} {t('ladder.points', 'Points')}
          </RunnerUpPointsValue>
        </RunnerUpPoints>
      </RunnerUpCard>
    )
  })
  return cards.length ? (
    <Podium>
      {cards[0]}
      <RunnersUp>{cards.slice(1)}</RunnersUp>
    </Podium>
  ) : null
}
