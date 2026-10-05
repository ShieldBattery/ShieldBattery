import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MatchmakingSeasonJson } from '../../common/matchmaking'
import { longTimestamp, monthDay } from '../i18n/date-formats'
import { useFormat } from '../i18n/locale-formats'
import { Tooltip } from '../material/tooltip'
import { useCurrentMinuteMs } from '../react/date-hooks'

/**
 * Returns when `season` ends, if that is known and hasn't passed yet. A season's end is only known
 * once a later season has been scheduled (it ends when that one starts).
 */
export function useUpcomingSeasonEnd(
  season: MatchmakingSeasonJson | undefined,
): number | undefined {
  const nowMs = useCurrentMinuteMs()
  return season?.endDate !== undefined && season.endDate > nowMs ? season.endDate : undefined
}

// The Tooltip's wrapper inherits its parent's display, which would put the text on its own line
// inside a block of running text.
const InlineTooltip = styled(Tooltip)`
  display: inline;
`

/** Shows a season's end as a date ("Ends November 1"), with the exact time in a tooltip. */
export function SeasonEndDate({ endDate, className }: { endDate: number; className?: string }) {
  const { t } = useTranslation()
  const monthDayFormat = useFormat(monthDay)
  const longTimestampFormat = useFormat(longTimestamp)

  return (
    <InlineTooltip
      className={className}
      text={longTimestampFormat.format(endDate)}
      position='bottom'>
      {t('matchmaking.season.endsOn', 'Ends {{date}}', { date: monthDayFormat.format(endDate) })}
    </InlineTooltip>
  )
}
