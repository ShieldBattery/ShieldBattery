import { TFunction } from 'i18next'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BotView } from '../../common/bots/bot-view'
import {
  RecommendationBand,
  hasAnyCalibratedBot,
  recommendBots,
} from '../../common/bots/practice-logic'
import { MatchmakingType } from '../../common/matchmaking'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilterChip } from '../material/filter-chip'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodySmall, labelSmall, titleSmall } from '../styles/typography'

const Root = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const SectionLabel = styled.div`
  ${labelSmall};
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const SectionRule = styled.span`
  flex-grow: 1;
  height: 1px;
  background-color: var(--theme-outline-variant);
`

const SectionNote = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const EmptyState = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 16px 20px;
  border-radius: 8px;

  display: flex;
  align-items: center;
  gap: 16px;
`

/** A tinted disc that spans both lines of the empty-state text, so the icon doesn't float. */
const EmptyIcon = styled.div`
  flex-shrink: 0;
  width: 40px;
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background-color: var(--theme-container-highest);
  color: var(--theme-on-surface-variant);
`

const EmptyText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const EmptyTitle = styled.div`
  ${titleSmall};
`

const EmptyBody = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const BandChips = styled.div`
  display: flex;
  gap: 8px;
`

const CardGrid = styled.div`
  display: grid;
  /* Four across at the full page width, fewer as the window or the lineup panel take space. */
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
`

const BAND_ORDER: ReadonlyArray<RecommendationBand> = ['gentler', 'even', 'tougher']

function bandLabel(band: RecommendationBand, t: TFunction): string {
  switch (band) {
    case 'gentler':
      return t('practice.recommendations.gentler', 'Gentler')
    case 'even':
      return t('practice.recommendations.even', 'Even match')
    case 'tougher':
      return t('practice.recommendations.tougher', 'Tougher')
    default:
      return band satisfies never
  }
}

export interface RecommendationsProps {
  /** The bots the picker's filters left visible. */
  bots: BotView[]
  /** Renders one bot's card; the note explains why it was recommended. */
  renderCard: (bot: BotView, note: string) => React.ReactNode
  className?: string
}

/**
 * The "Recommended for you" section of the bot picker. Recommendations come from the player's 1v1
 * ladder rating, so the section explains itself rather than disappearing when there is no rating,
 * no connection, or nothing measured near the player.
 */
export function Recommendations({ bots, renderCard, className }: RecommendationsProps) {
  const { t } = useTranslation()
  const [band, setBand] = useState<RecommendationBand>('even')
  const selfRank = useAppSelector(s => s.selfRank.byType.get(MatchmakingType.Match1v1))
  const [lastKnownRating, setLastKnownRating] = useUserLocalStorageValue<number>(
    'practice.lastKnownRating',
  )

  const liveRating = selfRank?.rating

  useEffect(() => {
    if (liveRating !== undefined && liveRating !== lastKnownRating) {
      setLastKnownRating(liveRating)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setter identity changes every render
  }, [liveRating, lastKnownRating])

  const rating = liveRating ?? lastKnownRating
  const usingLastKnown = liveRating === undefined && lastKnownRating !== undefined

  let note: string | undefined
  let chips: React.ReactNode = null
  let cards: React.ReactNode

  if (rating === undefined) {
    cards = (
      <EmptyState>
        <EmptyIcon>
          <MaterialIcon icon='leaderboard' size={24} />
        </EmptyIcon>
        <EmptyText>
          <EmptyTitle>
            {t('practice.recommendations.noRatingTitle', 'No 1v1 rating yet')}
          </EmptyTitle>
          <EmptyBody>
            {t(
              'practice.recommendations.noRatingBody',
              'Play some ranked 1v1 games and bots near your rating will be suggested here. ' +
                'Every bot is still available below.',
            )}
          </EmptyBody>
        </EmptyText>
      </EmptyState>
    )
  } else if (!hasAnyCalibratedBot(bots)) {
    cards = (
      <EmptyState>
        <EmptyIcon>
          <MaterialIcon icon='hourglass_empty' size={24} />
        </EmptyIcon>
        <EmptyText>
          <EmptyTitle>
            {t('practice.recommendations.noCalibratedTitle', 'No rated bots yet')}
          </EmptyTitle>
          <EmptyBody>
            {t(
              'practice.recommendations.noCalibratedBody',
              'Once bots have a measured strength, the ones near your rating will show up here.',
            )}
          </EmptyBody>
        </EmptyText>
      </EmptyState>
    )
  } else {
    note = usingLastKnown
      ? t('practice.recommendations.lastKnown', 'Near your last known 1v1 rating (offline)')
      : t('practice.recommendations.nearRating', 'Near your current 1v1 rating')
    chips = (
      <BandChips>
        {BAND_ORDER.map(b => (
          <FilterChip
            key={b}
            label={bandLabel(b, t)}
            selected={b === band}
            onClick={() => setBand(b)}
          />
        ))}
      </BandChips>
    )

    const recommended = recommendBots(bots, rating, band)
    cards =
      recommended.length > 0 ? (
        <CardGrid>
          {recommended.map(rec => (
            <React.Fragment key={rec.bot.key}>
              {renderCard(
                rec.bot,
                t('practice.recommendations.ratingNote', {
                  defaultValue: 'Measured around {{rating}} rating',
                  rating: Math.round(rec.rating),
                }),
              )}
            </React.Fragment>
          ))}
        </CardGrid>
      ) : (
        <EmptyState>
          <EmptyIcon>
            <MaterialIcon icon='search_off' size={24} />
          </EmptyIcon>
          <EmptyText>
            <EmptyTitle>
              {t('practice.recommendations.emptyBandTitle', 'Nothing in this range')}
            </EmptyTitle>
            <EmptyBody>
              {t(
                'practice.recommendations.emptyBandBody',
                'No rated bots are near your rating here. Try a gentler or tougher range, or ' +
                  'browse all bots below.',
              )}
            </EmptyBody>
          </EmptyText>
        </EmptyState>
      )
  }

  return (
    <Root className={className}>
      <SectionHeader>
        <SectionLabel>{t('practice.recommendations.title', 'Recommended for you')}</SectionLabel>
        <SectionRule />
        {note ? <SectionNote>{note}</SectionNote> : null}
      </SectionHeader>
      {chips}
      {cards}
    </Root>
  )
}
