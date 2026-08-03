import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { gameTypeToLabel, isTeamType } from '../../../../../common/games/game-type'
import { hasObservers } from '../../../../../common/lobbies'
import { LobbyChangedSetting } from '../../../../../common/lobbies/lobby-network'
import { MapImageInfo, MapInfo, SbMapId } from '../../../../../common/maps'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { FightingSpirit } from '../../../../maps/devonly/maps-for-testing'
import { MapThumbnail } from '../../../../maps/map-thumbnail'
import { TextButton } from '../../../../material/button'
import {
  headlineMedium,
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
} from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { BoardModel, formatElapsed, logBoardAction } from './board-model'

const HERO_HEIGHT_PX = 264

const HeroFrame = styled.div`
  position: relative;
  height: ${HERO_HEIGHT_PX}px;
  flex-shrink: 0;

  border-radius: 12px;
  border: 1px solid var(--theme-outline-variant);
  contain: paint;
`

const HeroImage = styled(MapThumbnail)<{ $subdued: boolean }>`
  position: absolute;
  inset: 0;
  border-radius: 0;

  filter: ${props => (props.$subdued ? 'grayscale(0.55) brightness(0.5)' : 'none')};
  transition: filter 250ms linear;
`

/**
 * Darkens the map behind the hero's text. Heavier at the top and bottom edges, where the title and
 * the settings chips sit, so the middle of the map stays legible as a map.
 */
const HeroScrim = styled.div`
  position: absolute;
  inset: 0;

  background:
    linear-gradient(
      to bottom,
      rgb(from var(--color-blue10) r g b / 0.86) 0%,
      rgb(from var(--color-blue10) r g b / 0.32) 38%,
      rgb(from var(--color-blue10) r g b / 0.42) 62%,
      rgb(from var(--color-blue10) r g b / 0.92) 100%
    ),
    linear-gradient(to right, rgb(from var(--color-blue10) r g b / 0.6) 0%, transparent 60%);
`

const HeroContent = styled.div`
  position: absolute;
  inset: 0;
  padding: 16px 20px 20px;

  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
`

const HeroTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`

const TitleBlock = styled.div`
  min-width: 0;
`

const LobbyName = styled.h2`
  ${headlineMedium};
  ${singleLine};
  color: var(--theme-on-surface);
`

const HostLine = styled.div`
  ${labelMedium};
  margin-top: 2px;
  color: var(--theme-on-surface-variant);

  display: flex;
  align-items: center;
  gap: 6px;
`

const TitleActions = styled.div`
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
`

const VisibilityBadge = styled.div`
  ${labelSmall};
  height: 24px;
  padding-inline: 8px;

  display: inline-flex;
  align-items: center;
  gap: 4px;

  border: 1px solid var(--theme-outline);
  border-radius: 12px;
  background-color: rgb(from var(--color-blue10) r g b / 0.6);
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const StatusPill = styled.div<{ $tone: 'idle' | 'urgent' | 'live' | 'positive' }>`
  ${labelLarge};
  height: 32px;
  padding-inline: 12px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  gap: 8px;

  border-radius: 16px;
  border: 1px solid;
  font-feature-settings: 'tnum' on;

  ${props => {
    switch (props.$tone) {
      case 'urgent':
        return css`
          border-color: rgb(from var(--theme-amber) r g b / 0.5);
          background-color: rgb(from var(--theme-amber) r g b / 0.16);
          color: var(--theme-amber);
        `
      case 'live':
        return css`
          border-color: rgb(from var(--theme-primary) r g b / 0.6);
          background-color: rgb(from var(--theme-primary) r g b / 0.2);
          color: var(--color-blue80);
        `
      case 'positive':
        return css`
          border-color: rgb(from var(--theme-positive) r g b / 0.5);
          background-color: rgb(from var(--theme-positive) r g b / 0.16);
          color: var(--theme-positive);
        `
      default:
        return css`
          border-color: var(--theme-outline);
          background-color: rgb(from var(--color-blue10) r g b / 0.72);
          color: var(--theme-on-surface-variant);
        `
    }
  }}
`

const StatusDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: currentColor;
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

/**
 * Calls out a setting the host just changed: a quick amber wash on mount that settles into a
 * lasting amber tint, so the change is both noticed live and still readable a moment later.
 */
const changedFlash = keyframes`
  from {
    background-color: rgb(from var(--theme-amber) r g b / 0.5);
    border-color: var(--theme-amber);
  }
  to {
    background-color: rgb(from var(--theme-amber) r g b / 0.16);
    border-color: rgb(from var(--theme-amber) r g b / 0.6);
  }
`

const SettingChip = styled.div<{ $changed: boolean }>`
  ${labelLarge};
  height: 32px;
  padding-inline: 10px 12px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border-radius: 8px;
  border: 1px solid;

  ${props =>
    props.$changed
      ? css`
          animation: ${changedFlash} 900ms ease-out 1;
          background-color: rgb(from var(--theme-amber) r g b / 0.16);
          border-color: rgb(from var(--theme-amber) r g b / 0.6);
          color: var(--theme-amber);
        `
      : css`
          background-color: rgb(from var(--color-blue10) r g b / 0.72);
          border-color: var(--theme-outline);
          color: var(--theme-on-surface);
        `};
`

const ChipLabel = styled.span`
  ${singleLine};
`

/**
 * The redesign's mock maps have no rendered map images, so the hero falls back to the shared
 * testing map's imagery to show what the treatment looks like. Everything else — name, dimensions,
 * id — still comes from the lobby's own map.
 */
function heroMapImage(map: MapInfo): ReadonlyDeep<MapImageInfo & { id: SbMapId }> {
  if (map.image256Url) {
    return map
  }

  const { image256Url, image512Url, image1024Url, image2048Url } = FightingSpirit
  return { ...map, image256Url, image512Url, image1024Url, image2048Url }
}

function StatusIndicator({ model }: { model: BoardModel }) {
  switch (model.lifecycle) {
    case 'countingDown':
      return (
        <StatusPill $tone='urgent'>
          <StatusDot />
          {model.startModel === 'readyChecks' ? 'Everyone ready · launching' : 'Starting'}
        </StatusPill>
      )
    case 'inGame':
      return (
        <StatusPill $tone='live'>
          <MaterialIcon icon='sports_esports' size={20} />
          {`In game · ${formatElapsed(model.data.runState?.elapsedMs ?? 0)}`}
        </StatusPill>
      )
    case 'regroup':
      return (
        <StatusPill $tone='positive'>
          <MaterialIcon icon='replay' size={20} />
          Regrouping
        </StatusPill>
      )
    default:
      return (
        <StatusPill $tone='idle'>
          <StatusDot />
          {`${model.takenSeatCount} / ${model.seatCount} seats filled`}
        </StatusPill>
      )
  }
}

interface SettingChipSpec {
  icon: string
  label: string
  setting?: LobbyChangedSetting
}

function settingChips(model: BoardModel, t: TFunction): SettingChipSpec[] {
  const lobby = model.lobby
  const chips: SettingChipSpec[] = [
    { icon: 'map', label: lobby.map?.name ?? 'No map', setting: 'map' },
    { icon: 'strategy', label: gameTypeToLabel(lobby.gameType, t), setting: 'gameType' },
  ]

  if (isTeamType(lobby.gameType)) {
    chips.push({ icon: 'groups', label: `${lobby.gameSubType} teams`, setting: 'gameSubType' })
  }
  chips.push({
    icon: 'speed',
    label: lobby.useLegacyLimits ? 'Legacy unit limit' : 'Extended unit limit',
    setting: 'useLegacyLimits',
  })
  chips.push({
    icon: 'visibility',
    label: hasObservers(lobby) ? 'Observers allowed' : 'No observers',
    setting: 'allowObservers',
  })

  return chips
}

/**
 * The war room's backdrop: the lobby's map at full width with the identity and settings that
 * describe the game laid over it. Everything a visitor needs to decide "am I in the right place"
 * lives here, so the board below can be nothing but seats.
 */
export function MapHero({ model }: { model: BoardModel }) {
  const { t } = useTranslation()
  const lobby = model.lobby
  const map = lobby.map

  return (
    <HeroFrame>
      {map ? (
        <HeroImage map={heroMapImage(map)} size={1024} $subdued={model.lifecycle === 'inGame'} />
      ) : null}
      <HeroScrim />
      <HeroContent>
        <HeroTop>
          <TitleBlock>
            <LobbyName>{lobby.name}</LobbyName>
            <HostLine>
              <MaterialIcon icon='star' size={16} />
              <span>Hosted by</span>
              {lobby.host.userId !== undefined ? (
                <ConnectedUsername userId={lobby.host.userId} interactive={false} />
              ) : null}
            </HostLine>
            <TitleActions>
              <VisibilityBadge>
                <MaterialIcon
                  icon={lobby.visibility === 'unlisted' ? 'lock' : 'public'}
                  size={14}
                />
                {lobby.visibility === 'unlisted' ? 'Unlisted' : 'Public'}
              </VisibilityBadge>
              <TextButton
                label='Copy invite link'
                iconStart={<MaterialIcon icon='link' size={20} />}
                onClick={() => logBoardAction('copyInviteLink', lobby.id)}
              />
            </TitleActions>
          </TitleBlock>
          <StatusIndicator model={model} />
        </HeroTop>
        <ChipRow>
          {settingChips(model, t).map(chip => (
            <SettingChip
              key={chip.icon + chip.label}
              $changed={!!chip.setting && model.changedSettings.has(chip.setting)}>
              <MaterialIcon icon={chip.icon} size={18} />
              <ChipLabel>{chip.label}</ChipLabel>
            </SettingChip>
          ))}
        </ChipRow>
      </HeroContent>
    </HeroFrame>
  )
}
