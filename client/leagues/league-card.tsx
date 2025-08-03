import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LeagueJson } from '../../common/leagues/leagues'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { longTimestamp, monthDay, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton, useButtonState } from '../material/button'
import { Card } from '../material/card'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { FlexSpacer } from '../styles/flex-spacer'
import { bodyMedium, labelMedium, titleLarge } from '../styles/typography'
import { LeagueBadge } from './league-badge'
import { LeagueImage, LeaguePlaceholderImage } from './league-image'
import { LeagueSectionType } from './league-section-type'

const LeagueCardRoot = styled(Card)`
  position: relative;
  width: 352px;
  padding: 0;

  display: flex;
  flex-direction: column;

  contain: content;
  cursor: pointer;
`

const LeagueImageAndBadge = styled.div`
  box-sizing: content-box;
  position: relative;
  padding-bottom: 20px;
`

const LeagueCardBadge = styled.div`
  ${elevationPlus1};
  position: absolute;
  left: 12px;
  bottom: 0;
  width: 52px;
  height: 52px;
  padding: 6px;

  background: var(--sb-color-background);
  border-radius: 16px;
`

const LeagueName = styled.div`
  ${titleLarge};
  margin-top: 4px;
  padding: 0 16px;
`

const LeagueFormatAndDate = styled.div`
  ${labelMedium};
  padding: 0 16px;
`

const LeagueDescription = styled.div`
  ${bodyMedium};
  margin-top: 16px;
  padding: 0 16px;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  line-clamp: 3;
  -webkit-line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;
`

const LeagueActions = styled.div`
  padding: 16px 0 10px 16px;

  display: flex;
  justify-content: space-between;
`

const DateTooltip = styled(Tooltip)`
  display: inline-flex;
`

const JoinedIndicator = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

export function LeagueCard({
  league,
  type,
  curDate,
  joined,
  actionText,
  href,
}: {
  league: ReadonlyDeep<LeagueJson>
  type: LeagueSectionType
  curDate: number
  joined: boolean
  actionText: string
  href: string
}) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({})

  let dateText: string
  let dateTooltip: string
  switch (type) {
    case LeagueSectionType.Current:
      dateText = t('leagues.list.ends', {
        defaultValue: 'Ends {{endDate}}',
        endDate: narrowDuration.format(league.endAt, curDate),
      })
      dateTooltip = longTimestamp.format(league.endAt)
      break
    case LeagueSectionType.Future:
      dateText = t('leagues.list.starts', {
        defaultValue: 'Starts {{startDate}}',
        startDate: narrowDuration.format(league.startAt, curDate),
      })
      dateTooltip = longTimestamp.format(league.startAt)
      break
    case LeagueSectionType.Past:
      dateText = `${monthDay.format(league.startAt)}\u2013${monthDay.format(league.endAt)}`
      dateTooltip = `${longTimestamp.format(league.startAt)}\u2013${longTimestamp.format(
        league.endAt,
      )}`
      break
    default:
      assertUnreachable(type)
  }

  return (
    <LinkButton href={href} tabIndex={0}>
      <LeagueCardRoot {...buttonProps}>
        <LeagueImageAndBadge>
          {league.imagePath ? <LeagueImage src={league.imagePath} /> : <LeaguePlaceholderImage />}
          <LeagueCardBadge>
            <LeagueBadge league={league} />
          </LeagueCardBadge>
        </LeagueImageAndBadge>
        <LeagueName>{league.name}</LeagueName>
        <LeagueFormatAndDate>
          {matchmakingTypeToLabel(league.matchmakingType, t)} ·{' '}
          <DateTooltip text={dateTooltip} position={'right'}>
            {dateText}
          </DateTooltip>
        </LeagueFormatAndDate>
        <LeagueDescription>{league.description}</LeagueDescription>
        <FlexSpacer />
        <LeagueActions>
          {joined ? (
            <JoinedIndicator>
              <MaterialIcon icon='check' />
              <span>{t('leagues.list.joined', 'Joined')}</span>
            </JoinedIndicator>
          ) : (
            <div />
          )}
          {/*
          NOTE(tec27): This intentionally doesn't have an onClick handler as it is handled by the
          card and having both would cause 2 navigations to occur.
        */}
          <TextButton label={actionText} />
        </LeagueActions>
        <Ripple ref={rippleRef} />
      </LeagueCardRoot>
    </LinkButton>
  )
}
