import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import {
  BotFormatId,
  BotFormatSupport,
  BotPlayStyleTag,
  BotRaceName,
  botRaceToRaceChar,
  BotRuntime,
} from '../../common/bots/bot-catalog'
import { architectureLabel, BotView, findJavaRuntime } from '../../common/bots/bot-view'
import {
  getDivisionColor,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  POINTS_FOR_RATING_TARGET_FACTOR,
  pointsToMatchmakingDivision,
} from '../../common/matchmaking'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import { DivisionIcon, UnratedIcon } from '../matchmaking/rank-icon'
import { buttonReset } from '../material/button-reset'
import { bodySmall, labelLarge, labelMedium, labelSmall, singleLine } from '../styles/typography'
import { openGetJavaLink } from './bot-actions'
import { botLibraryAtom } from './practice-atoms'

const BYTES_PER_MEGABYTE = 1024 * 1024

/**
 * Divisions are assigned from ladder points rather than ratings, and a bot's strength estimate is
 * a rating, so it is placed where a player of that rating's points are expected to settle.
 */
export function botRatingToDivision(rating: number): MatchmakingDivision {
  return pointsToMatchmakingDivision(true, rating * POINTS_FOR_RATING_TARGET_FACTOR, 0)
}

export function botRaceToLabel(race: BotRaceName, t: TFunction): string {
  switch (race) {
    case 'zerg':
      return t('game.race.zerg', 'Zerg')
    case 'terran':
      return t('game.race.terran', 'Terran')
    case 'protoss':
      return t('game.race.protoss', 'Protoss')
    default:
      return race satisfies never
  }
}

/** Package sizes are only ever shown as whole megabytes; exact byte counts help no one here. */
export function formatMegabytes(bytes: number, t: TFunction): string {
  return t('practice.bots.megabytes', {
    defaultValue: '{{value}} MB',
    value: Math.round(bytes / BYTES_PER_MEGABYTE),
  })
}

export function javaRuntimeLabel(runtime: Extract<BotRuntime, { kind: 'java' }>, t: TFunction) {
  return t('practice.bots.javaVersion', {
    defaultValue: 'Java {{major}}',
    major: runtime.major,
  })
}

export function javaRuntimeLabelWithArchitecture(
  runtime: Extract<BotRuntime, { kind: 'java' }>,
  t: TFunction,
) {
  return t('practice.bots.javaVersionWithArchitecture', {
    defaultValue: 'Java {{major}} ({{architecture}})',
    major: runtime.major,
    architecture: architectureLabel(runtime.architecture),
  })
}

const RaceIconListRoot = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ListedRaceIcon = styled(RaceIcon)<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;

  fill: currentColor;
`

export interface RaceIconListProps {
  races: ReadonlyArray<BotRaceName>
  /** The pixel size of each icon. Defaults to 16. */
  size?: number
  className?: string
}

export function RaceIconList({ races, size = 16, className }: RaceIconListProps) {
  const { t } = useTranslation()

  return (
    <RaceIconListRoot className={className}>
      {races.map(race => (
        <ListedRaceIcon
          key={race}
          race={botRaceToRaceChar(race)}
          ariaLabel={botRaceToLabel(race, t)}
          $size={size}
        />
      ))}
    </RaceIconListRoot>
  )
}

const PlayStyleTagsRoot = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
`

const PlayStyleTag = styled.span`
  ${labelSmall};
  ${singleLine};

  height: 22px;
  padding: 0 8px;

  display: inline-flex;
  align-items: center;

  border-radius: 4px;
  background-color: var(--theme-container-highest);
  color: var(--theme-on-surface-variant);
`

/**
 * The tags a bot is shown with everywhere: its play-style tags plus a learning tag when it keeps
 * history between games, so that trait reads the same on cards, details and results.
 */
const PLAY_STYLE_TAG_LABELS: Record<BotPlayStyleTag, (t: TFunction) => string> = {
  'air-focused': t => t('practice.playStyle.airFocused', 'Air armies'),
  bio: t => t('practice.playStyle.bio', 'Bio'),
  mech: t => t('practice.playStyle.mech', 'Mech'),
  aggressive: t => t('practice.playStyle.aggressive', 'Aggressive'),
  cheese: t => t('practice.playStyle.cheese', 'Cheese'),
  defensive: t => t('practice.playStyle.defensive', 'Defensive'),
  macro: t => t('practice.playStyle.macro', 'Macro'),
  'timing-attack': t => t('practice.playStyle.timingAttack', 'Timing attack'),
  drops: t => t('practice.playStyle.drops', 'Drops'),
  harassment: t => t('practice.playStyle.harassment', 'Harassment'),
  'micro-heavy': t => t('practice.playStyle.microHeavy', 'Micro-heavy'),
  reactive: t => t('practice.playStyle.reactive', 'Reactive'),
  'varied-openings': t => t('practice.playStyle.variedOpenings', 'Varied openings'),
}

/**
 * The label for a catalog play-style tag ID, or undefined for an ID this build doesn't know. The
 * catalog only ever carries IDs; a newer catalog may add one before the app learns its label, and
 * such a tag is kept in the data but never shown raw.
 */
export function playStyleTagLabel(tag: string, t: TFunction): string | undefined {
  return Object.hasOwn(PLAY_STYLE_TAG_LABELS, tag)
    ? PLAY_STYLE_TAG_LABELS[tag as BotPlayStyleTag](t)
    : undefined
}

/** The labels of a bot's known play-style tags, in catalog order. */
export function playStyleTagLabels(bot: BotView, t: TFunction): string[] {
  return bot.playStyleTags.flatMap(tag => {
    const label = playStyleTagLabel(tag, t)
    return label ? [label] : []
  })
}

export function botDisplayTags(bot: BotView, t: TFunction): string[] {
  const tags = playStyleTagLabels(bot, t)
  return bot.learning.mode === 'persistent'
    ? [...tags, t('practice.bots.learnsTag', 'Learns')]
    : tags
}

export function PlayStyleTags({
  tags,
  className,
}: {
  tags: ReadonlyArray<string>
  className?: string
}) {
  if (tags.length === 0) {
    return null
  }

  return (
    <PlayStyleTagsRoot className={className}>
      {tags.map(tag => (
        <PlayStyleTag key={tag}>{tag}</PlayStyleTag>
      ))}
    </PlayStyleTagsRoot>
  )
}

type StatusTone = 'success' | 'amber' | 'error' | 'neutral'

function toneColor(tone: StatusTone): string {
  switch (tone) {
    case 'success':
      return 'var(--theme-success)'
    case 'amber':
      return 'var(--theme-amber-container)'
    case 'error':
      return 'var(--theme-error)'
    case 'neutral':
      return 'var(--theme-on-surface-variant)'
    default:
      return tone satisfies never
  }
}

const StatusLine = styled.span<{ $tone: StatusTone; $dense: boolean }>`
  ${props => (props.$dense ? labelMedium : labelLarge)};

  display: inline-flex;
  align-items: center;
  gap: 4px;

  color: ${props => toneColor(props.$tone)};
`

const ReadinessRoot = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
`

const SubText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const LinkButton = styled.button`
  ${buttonReset};
  ${labelMedium};

  color: var(--theme-amber);
  text-decoration: underline;
  cursor: pointer;
`

export interface ReadinessBadgeProps {
  bot: BotView
  size?: 'small' | 'medium'
  className?: string
}

/**
 * The one-line answer to "can this bot play right now?", plus the runtime line a Java bot needs to
 * make that answer actionable.
 */
export function ReadinessBadge({ bot, size = 'medium', className }: ReadinessBadgeProps) {
  const { t } = useTranslation()
  const library = useAtomValue(botLibraryAtom)
  const dense = size === 'small'

  let tone: StatusTone = 'neutral'
  let icon = 'help'
  let text = ''
  switch (bot.readiness.state) {
    case 'ready':
      tone = 'success'
      icon = 'check_circle'
      text = t('practice.bots.ready', 'Ready')
      break
    case 'notInstalled':
      tone = 'amber'
      icon = 'download'
      text = bot.readiness.canDownload
        ? t('practice.bots.notInstalledWithSize', {
            defaultValue: 'Not installed · {{size}}',
            size: formatMegabytes(bot.readiness.sizeBytes, t),
          })
        : t('practice.bots.notInstalled', 'Not installed')
      break
    case 'installing':
      tone = 'amber'
      icon = 'download'
      text = t('practice.bots.downloadingProgress', {
        defaultValue: 'Downloading {{received}} of {{total}}',
        received: Math.round(bot.readiness.progress.receivedBytes / BYTES_PER_MEGABYTE),
        total: formatMegabytes(bot.readiness.progress.totalBytes, t),
      })
      break
    case 'installFailed':
      tone = 'error'
      icon = 'error'
      text = t('practice.bots.downloadFailed', 'Download failed')
      break
    case 'missingRuntime':
      tone = 'error'
      icon = 'error'
      text = t('practice.bots.needsRuntime', {
        defaultValue: 'Needs {{runtime}}',
        runtime: javaRuntimeLabel(bot.readiness.runtime, t),
      })
      break
    case 'missingFiles':
      tone = 'error'
      icon = 'error'
      text = bot.readiness.detail
      break
    default:
      bot.readiness satisfies never
  }

  const runtime = bot.runtime
  let runtimeLine: React.ReactNode
  if (runtime.kind === 'java') {
    const hasJava = !!bot.javaOverride || !!findJavaRuntime(library?.java.detected ?? [], runtime)
    if (!hasJava) {
      runtimeLine = (
        <div>
          {bot.readiness.state !== 'missingRuntime' ? (
            <StatusLine $tone='error' $dense={dense}>
              <MaterialIcon icon='error' size={dense ? 17 : 18} />
              {t('practice.bots.runtimeNotInstalled', {
                defaultValue: '{{runtime}} not installed',
                runtime: javaRuntimeLabel(runtime, t),
              })}
            </StatusLine>
          ) : null}
          <div>
            <LinkButton type='button' onClick={() => openGetJavaLink(runtime)}>
              {t('practice.bots.getRuntime', {
                defaultValue: 'Get {{runtime}}',
                runtime: javaRuntimeLabel(runtime, t),
              })}
            </LinkButton>
          </div>
        </div>
      )
    }
  }

  let detailLine: React.ReactNode
  if (bot.readiness.state === 'notInstalled' && !bot.readiness.canDownload) {
    detailLine = (
      <SubText>
        {t(
          'practice.bots.noReleaseAvailable',
          'No download is listed for this bot right now. Refresh the bot list to look again.',
        )}
      </SubText>
    )
  } else if (bot.readiness.state === 'installFailed') {
    detailLine = <SubText>{bot.readiness.failure.error}</SubText>
  }

  return (
    <ReadinessRoot className={className}>
      <StatusLine $tone={tone} $dense={dense}>
        <MaterialIcon icon={icon} size={dense ? 17 : 18} />
        {text}
      </StatusLine>
      {detailLine}
      {runtimeLine}
    </ReadinessRoot>
  )
}

const StrengthRoot = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 56px;
`

const StrengthLabel = styled.div<{ $color: string }>`
  ${labelSmall};
  ${singleLine};

  color: ${props => props.$color};
`

const strengthIconStyle = css`
  flex-shrink: 0;
`

const StyledDivisionIcon = styled(DivisionIcon)<{ $size: number }>`
  ${strengthIconStyle};
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
`

const StyledUnratedIcon = styled(UnratedIcon)<{ $size: number }>`
  ${strengthIconStyle};
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
`

export interface StrengthBadgeProps {
  bot: BotView
  /** Which race's estimate to show. Defaults to the bot's strongest rated race. */
  race?: BotRaceName
  /** The pixel size of the division icon. Defaults to 40. */
  size?: number
  className?: string
}

/**
 * How a bot's measured strength compares to the ladder. Ratings that haven't been measured enough
 * to trust as a division are marked as provisional rather than hidden.
 */
export function StrengthBadge({ bot, race, size = 40, className }: StrengthBadgeProps) {
  const { t } = useTranslation()

  let estimate = race ? bot.strength.find(s => s.race === race)?.estimate : undefined
  if (!race) {
    for (const entry of bot.strength) {
      if (entry.estimate && (!estimate || entry.estimate.rating > estimate.rating)) {
        estimate = entry.estimate
      }
    }
  }

  if (!estimate) {
    return (
      <StrengthRoot className={className}>
        <StyledUnratedIcon size={size} $size={size} />
        <StrengthLabel $color={getDivisionColor(MatchmakingDivision.Unrated)}>
          {t('practice.bots.notYetRated', 'Unrated')}
        </StrengthLabel>
      </StrengthRoot>
    )
  }

  const division = botRatingToDivision(estimate.rating)
  const label = matchmakingDivisionToLabel(division, t)

  return (
    <StrengthRoot className={className}>
      <StyledDivisionIcon division={division} size={size} $size={size} />
      <StrengthLabel $color={getDivisionColor(division)}>
        {estimate.state === 'provisional'
          ? t('practice.bots.provisionalDivision', {
              defaultValue: '{{division}} (provisional)',
              division: label,
            })
          : label}
      </StrengthLabel>
    </StrengthRoot>
  )
}

const FormatRoot = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const FormatLabel = styled.span`
  ${labelLarge};
  color: var(--theme-on-surface);
`

const FormatState = styled.span<{ $tone: StatusTone }>`
  ${bodySmall};
  color: ${props => toneColor(props.$tone)};
`

const FormatIcon = styled(MaterialIcon)<{ $tone: StatusTone }>`
  color: ${props => toneColor(props.$tone)};
`

export function botFormatLabel(format: BotFormatId, t: TFunction): string {
  switch (format) {
    case 'one-v-one':
      return t('practice.bots.format.oneVsOne', '1v1 melee')
    case 'free-for-all':
      return t('practice.bots.format.freeForAll', 'Two or more opponents')
    case 'teams':
      return t('practice.bots.format.teams', 'Team melee')
    default:
      return format satisfies never
  }
}

function formatSupportDisplay(
  support: BotFormatSupport,
  t: TFunction,
): { tone: StatusTone; icon: string; label: string } {
  switch (support) {
    case 'verified':
      return {
        tone: 'success',
        icon: 'check_circle',
        label: t('practice.bots.support.tested', 'Tested'),
      }
    case 'experimental':
      return {
        tone: 'amber',
        icon: 'science',
        label: t('practice.bots.support.experimental', 'Experimental'),
      }
    case 'unverified':
      return {
        tone: 'neutral',
        icon: 'help',
        label: t('practice.bots.support.untested', 'Untested'),
      }
    case 'incompatible':
      return {
        tone: 'error',
        icon: 'block',
        label: t('practice.bots.support.incompatible', 'Incompatible'),
      }
    default:
      return support satisfies never
  }
}

export interface FormatSupportLineProps {
  format: BotFormatId
  support: BotFormatSupport
  /** The package's own explanation, shown as the line's tooltip when it has one. */
  notes?: string
  className?: string
}

export function FormatSupportLine({ format, support, notes, className }: FormatSupportLineProps) {
  const { t } = useTranslation()
  const { tone, icon, label } = formatSupportDisplay(support, t)

  return (
    <FormatRoot className={className} title={notes || undefined}>
      <FormatIcon icon={icon} size={18} $tone={tone} />
      <FormatLabel>{botFormatLabel(format, t)}</FormatLabel>
      <FormatState $tone={tone}>{label}</FormatState>
    </FormatRoot>
  )
}
