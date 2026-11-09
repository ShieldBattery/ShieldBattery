import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { ReconciledResult } from '../../common/games/results'
import { MapInfoJson } from '../../common/maps'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { RaceIcon } from '../lobbies/race-icon'
import { getRaceColor } from '../styles/colors'
import { bodyMedium, bodySmall, displaySmall, labelMedium } from '../styles/typography'

const Root = styled.div`
  position: relative;
  width: calc(100% - 48px);
  margin: 8px 24px 16px;
  min-height: 188px;
  padding: 28px 32px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 12px;
  background-color: var(--theme-container-low);
  contain: paint;
`

const MapImage = styled.img`
  position: absolute;
  top: 0;
  right: 0;
  width: 55%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
`

/** The map identifies the match while the opaque left edge keeps the result readable. */
const MapShade = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    var(--theme-container-low) 38%,
    rgb(from var(--theme-container-low) r g b / 0.85) 57%,
    rgb(from var(--theme-container-low) r g b / 0.3) 100%
  );
`

/** Stands in for the map when it has no image to draw. */
const MapFallback = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--theme-container-low);
`

function Backdrop({ map }: { map?: ReadonlyDeep<MapInfoJson> }) {
  const [failedMapId, setFailedMapId] = useState<string>()
  const src = map?.image1024Url ?? map?.image512Url ?? map?.image2048Url

  if (!map || !src || failedMapId === map.id) {
    return <MapFallback />
  }

  const srcSet = [
    map.image512Url ? `${map.image512Url} 512w` : undefined,
    map.image1024Url ? `${map.image1024Url} 1024w` : undefined,
    map.image2048Url ? `${map.image2048Url} 2048w` : undefined,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <MapImage
        key={map.id}
        src={src}
        srcSet={srcSet}
        sizes='100vw'
        alt=''
        decoding='async'
        onError={() => setFailedMapId(map.id)}
      />
      <MapShade />
    </>
  )
}

const Content = styled.div`
  /* Above the backdrop, which is positioned and would otherwise paint over static content. */
  position: relative;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
`

const Eyebrow = styled.div`
  ${labelMedium};
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const PlayedAt = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const OUTCOME_COLORS: Partial<Record<ReconciledResult, string>> = {
  win: 'var(--theme-positive)',
  loss: 'var(--theme-negative)',
}

const Outcome = styled.h1<{ $color?: string }>`
  ${displaySmall};
  margin: 0;
  color: ${props => props.$color ?? 'var(--theme-on-surface)'};
  overflow-wrap: anywhere;
`

const MatchLine = styled.div`
  ${bodyMedium};

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 4px 10px;
  color: var(--theme-on-surface-variant);
`

const Side = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`

const RaceChip = styled.span<{ $race: RaceChar }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${props => getRaceColor(props.$race)};
`

const RaceMark = styled(RaceIcon)`
  width: 20px;
  height: 20px;
`

const Separator = styled.span`
  color: var(--theme-on-surface-variant);
`

export interface PostGameHeroProps {
  /** The map the game was played on, once it has loaded. */
  map?: ReadonlyDeep<MapInfoJson>
  /** What kind of game this was, e.g. "Ranked 1v1". */
  modeLabel?: string
  /** The headline: how the game went, or that this isn't known yet. */
  outcomeText: string
  /** The viewing player's result, which colors the headline. */
  result?: ReconciledResult
  /** The races on each side of the game, in the order to show them. */
  matchup: ReadonlyArray<ReadonlyArray<RaceChar>>
  /** How long the game lasted, already formatted. */
  duration?: string
  /** Localized date and time for identifying the match. */
  playedAt?: string
}

/** The banner across the top of a game's results when a player arrives there from the game. */
export function PostGameHero({
  map,
  modeLabel,
  outcomeText,
  result,
  matchup,
  duration,
  playedAt,
}: PostGameHeroProps) {
  const { t } = useTranslation()
  // Naming each race only fits, and only reads better than the icons, with one player per side.
  const showRaceNames = matchup.length === 2 && matchup.every(side => side.length === 1)
  const mapName = map?.name

  return (
    <Root data-testid='post-game-hero'>
      <Backdrop map={map} />
      <Content>
        <Eyebrow>{modeLabel}</Eyebrow>
        <Outcome $color={result ? OUTCOME_COLORS[result] : undefined}>{outcomeText}</Outcome>
        <MatchLine>
          {matchup.map((side, sideIndex) => (
            <Fragment key={sideIndex}>
              {sideIndex > 0 ? <Separator>{t('gameDetails.postGameVs', 'vs')}</Separator> : null}
              <Side>
                {side.map((race, raceIndex) => (
                  <RaceChip key={raceIndex} $race={race}>
                    <RaceMark race={race} />
                    {showRaceNames ? raceCharToLabel(race, t) : null}
                  </RaceChip>
                ))}
              </Side>
            </Fragment>
          ))}
          {mapName ? (
            <>
              {matchup.length ? <Separator>{'·'}</Separator> : null}
              <span>{mapName}</span>
            </>
          ) : null}
          {duration ? (
            <>
              <Separator>{'·'}</Separator>
              <span>{duration}</span>
            </>
          ) : null}
        </MatchLine>
        {playedAt ? <PlayedAt>{playedAt}</PlayedAt> : null}
      </Content>
    </Root>
  )
}
