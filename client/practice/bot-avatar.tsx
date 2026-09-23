import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ALL_BOT_RACE_NAMES, BotRaceName, botRaceToRaceChar } from '../../common/bots/bot-catalog'
import { RaceIcon } from '../lobbies/race-icon'
import { getRaceColor } from '../styles/colors'
import { botRaceToLabel } from './bot-badges'

const DEFAULT_SIZE = 48

/**
 * The races in the order their icons are laid out, left to right: Zerg, Terran, Protoss. All three
 * put the last one alone on the top row, so that order flips to keep Protoss bottom-left, Terran
 * bottom-right and Zerg on top.
 */
function iconOrder(races: ReadonlyArray<BotRaceName>): BotRaceName[] {
  const ordered = ALL_BOT_RACE_NAMES.filter(race => races.includes(race))
  return ordered.length === 3 ? ordered.reverse() : ordered
}

/**
 * The ring behind the inner disc: one wedge per race the bot can play, each wedge on the same side
 * as that race's icon. A single race fills the ring with that race's color instead of a gradient.
 */
function ringBackground(ordered: ReadonlyArray<BotRaceName>): string {
  // Wedges run clockwise from the ring's start. Two icons split left/right, so the ring starts at
  // the bottom and the left icon's wedge comes first. Three icons put the last one on top, so the
  // ring starts just left of the top: top, then bottom-right, then bottom-left.
  const clockwise =
    ordered.length === 3 ? [ordered[2], ordered[1], ordered[0]] : Array.from(ordered)
  const colors = clockwise.map(race => getRaceColor(botRaceToRaceChar(race)))
  if (colors.length === 0) {
    return 'var(--theme-outline-variant)'
  }
  if (colors.length === 1) {
    return colors[0]
  }

  const step = 360 / colors.length
  const stops = colors.map((color, i) => `${color} ${i * step}deg ${(i + 1) * step}deg`).join(', ')
  const from = colors.length === 2 ? 180 : -60
  return `conic-gradient(from ${from}deg, ${stops})`
}

const Root = styled.span<{ $size: number; $ring: string }>`
  position: relative;
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background: ${props => props.$ring};
`

const Disc = styled.span<{ $size: number }>`
  position: absolute;
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;

  border-radius: 50%;
  background-color: var(--theme-container-highest);
`

const Icons = styled.span<{ $width: number }>`
  position: relative;
  width: ${props => props.$width}px;

  display: flex;
  /* The first row fills from the bottom, so a third icon lands alone on top. */
  flex-wrap: wrap-reverse;
  align-items: center;
  justify-content: center;
  gap: 2px;
`

const Icon = styled(RaceIcon)<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;

  fill: currentColor;
`

export interface BotAvatarProps {
  races: ReadonlyArray<BotRaceName>
  /** The diameter in px. Defaults to 48. */
  size?: number
  className?: string
}

/** A bot's identity mark: a ring of its race colors around a disc of its race icons. */
export function BotAvatar({ races, size = DEFAULT_SIZE, className }: BotAvatarProps) {
  const { t } = useTranslation()

  const ordered = iconOrder(races)
  const discSize = size - Math.round(size * 0.17)
  const iconSize = Math.round(size * (ordered.length > 1 ? 0.355 : 0.46))
  const iconsWidth = ordered.length > 1 ? iconSize * 2 + 2 : iconSize

  const label = t('practice.botAvatar.plays', {
    defaultValue: 'Plays {{races}}',
    races: races.map(race => botRaceToLabel(race, t)).join(', '),
  })

  return (
    <Root
      className={className}
      role='img'
      aria-label={label}
      $size={size}
      $ring={ringBackground(ordered)}>
      <Disc $size={discSize} />
      <Icons $width={iconsWidth}>
        {ordered.map(race => (
          <Icon key={race} race={botRaceToRaceChar(race)} $size={iconSize} />
        ))}
      </Icons>
    </Root>
  )
}
