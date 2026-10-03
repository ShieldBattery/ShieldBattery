import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { MatchmakingDivision } from '../../common/matchmaking'
import {
  DEFAULT_TITLE_ID,
  getTitleDefinition,
  TitleDefinition,
  TitleDivision,
  TitleId,
  TitleTone,
} from '../../common/titles'
import { useFormatLocale } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { DivisionIcon } from '../matchmaking/rank-icon'
import { Tooltip } from '../material/tooltip'
import { getTitleName, getTitleRequirement } from './title-strings'

const TONE_COLORS: Readonly<Record<TitleTone, string | undefined>> = {
  // Standard titles keep whatever color the surface they're displayed on uses.
  [TitleTone.Standard]: undefined,
  [TitleTone.Protoss]: 'var(--theme-color-protoss)',
  [TitleTone.Zerg]: 'var(--theme-color-zerg)',
  [TitleTone.Terran]: 'var(--theme-color-terran)',
  [TitleTone.Random]: 'var(--theme-color-random)',
  [TitleTone.Staff]: 'var(--theme-amber)',
}

export function getTitleToneColor(tone: TitleTone): string | undefined {
  return TONE_COLORS[tone]
}

const TITLE_DIVISION_ICONS: Readonly<Record<TitleDivision, MatchmakingDivision>> = {
  [TitleDivision.Bronze]: MatchmakingDivision.Bronze1,
  [TitleDivision.Silver]: MatchmakingDivision.Silver1,
  [TitleDivision.Gold]: MatchmakingDivision.Gold1,
  [TitleDivision.Platinum]: MatchmakingDivision.Platinum1,
  [TitleDivision.Diamond]: MatchmakingDivision.Diamond1,
  [TitleDivision.Champion]: MatchmakingDivision.Champion,
}

const Root = styled.span<{ $color?: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  color: ${props => props.$color ?? 'inherit'};
`

const Name = styled.span<{ $wrap: boolean }>`
  min-width: 0;
  ${props =>
    props.$wrap
      ? css`
          overflow-wrap: break-word;
        `
      : css`
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `}
`

const StaffIcon = styled(MaterialIcon).attrs({ icon: 'shield', size: 16, filled: false })`
  flex-shrink: 0;
`

const RankBadge = styled(DivisionIcon)`
  flex-shrink: 0;
  width: 16px;
  height: 16px;
`

/**
 * The icon displayed before a title's name, if it has one: a shield for staff titles (whose amber
 * is close to the Protoss and Random race colors), and the division's badge for rank titles (whose
 * division colors are close to the race colors).
 */
export function TitleIcon({ definition }: { definition: TitleDefinition }) {
  if (definition.tone === TitleTone.Staff) {
    return <StaffIcon />
  } else if (definition.criterion.kind === 'division') {
    return <RankBadge division={TITLE_DIVISION_ICONS[definition.criterion.division]} size={16} />
  } else {
    return null
  }
}

export interface UserTitleProps {
  /** The title to display, or `undefined` for the default title. */
  titleId?: TitleId
  /** When the holder's account was created, which some titles display. */
  created?: number
  /** Whether hovering the title should explain how it's earned. */
  showRequirement?: boolean
  /**
   * Whether a title too long for the space wraps onto more lines. Otherwise it's cut off with an
   * ellipsis (for fixed-height spots like the app bar), and the full title is shown on hover.
   */
  wrap?: boolean
  className?: string
}

/** Displays a user's title in its tone, with its icon. */
export function UserTitle({
  titleId = DEFAULT_TITLE_ID,
  created,
  showRequirement = false,
  wrap = false,
  className,
}: UserTitleProps) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const definition = getTitleDefinition(titleId)
  const name = getTitleName(titleId, t, created)

  const title = (
    <Root className={className} $color={getTitleToneColor(definition.tone)}>
      <TitleIcon definition={definition} />
      <Name $wrap={wrap} title={wrap ? undefined : name}>
        {name}
      </Name>
    </Root>
  )

  return showRequirement && titleId !== DEFAULT_TITLE_ID ? (
    <Tooltip text={getTitleRequirement(definition, t, locale)} position='bottom'>
      {title}
    </Tooltip>
  ) : (
    title
  )
}
