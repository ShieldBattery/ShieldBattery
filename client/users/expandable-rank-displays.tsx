import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  DEFAULT_PROFILE_RANKS_SHOWN,
  getRankedTypesByActivity,
  LadderPlayer,
} from '../../common/ladder/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { TextButton } from '../material/button'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
`

const Cards = styled.div`
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
`

export interface ExpandableRankDisplaysProps {
  ladder: Partial<Record<MatchmakingType, LadderPlayer>>
  /** Renders a single rank card for the given mode. */
  children: (matchmakingType: MatchmakingType, ladderPlayer: LadderPlayer) => React.ReactNode
  className?: string
  /**
   * Called when the user wants to see the ranks beyond the default cap. When provided, the
   * component never expands inline: it shows an "And N more ranks" button that calls this instead
   * (useful in constrained containers like overlays, which can send the user to the full profile
   * rather than growing to fit every mode).
   */
  onShowMore?: () => void
  /**
   * Controls the expansion externally: when set (alongside `onExpandedChange`), the component
   * renders this expansion state and reports toggles instead of tracking its own.
   */
  expanded?: boolean
  /** Called with the new value when the user toggles expansion and `expanded` is provided. */
  onExpandedChange?: (expanded: boolean) => void
}

/**
 * Renders a user's per-mode rank cards, showing only their most-active modes by default. The rest
 * are revealed with an inline expansion toggle, or delegated to `onShowMore` when provided. Shared
 * by the profile page and the profile overlay; the caller supplies how each card is rendered via
 * `children`.
 */
export function ExpandableRankDisplays({
  ladder,
  children,
  className,
  onShowMore,
  expanded,
  onExpandedChange,
}: ExpandableRankDisplaysProps) {
  const { t } = useTranslation()
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = expanded ?? internalExpanded
  const setIsExpanded = (value: boolean) => {
    if (expanded !== undefined) {
      onExpandedChange?.(value)
    } else {
      setInternalExpanded(value)
    }
  }

  const rankedTypes = getRankedTypesByActivity(ladder)
  const shownTypes =
    isExpanded && !onShowMore ? rankedTypes : rankedTypes.slice(0, DEFAULT_PROFILE_RANKS_SHOWN)

  let expandButton
  if (rankedTypes.length > DEFAULT_PROFILE_RANKS_SHOWN) {
    if (onShowMore) {
      expandButton = (
        <TextButton
          label={t('users.profile.viewAllRanks', 'View all {{total}} ranks', {
            total: rankedTypes.length,
          })}
          onClick={onShowMore}
        />
      )
    } else {
      expandButton = (
        <TextButton
          label={
            isExpanded
              ? t('users.profile.showFewerRanks', 'Show fewer')
              : t('users.profile.showAllRanks', 'Show all {{total}} ranks', {
                  total: rankedTypes.length,
                })
          }
          onClick={() => setIsExpanded(!isExpanded)}
        />
      )
    }
  }

  return (
    <Root className={className}>
      <Cards>
        {shownTypes.map(matchmakingType => (
          <React.Fragment key={matchmakingType}>
            {children(matchmakingType, ladder[matchmakingType]!)}
          </React.Fragment>
        ))}
      </Cards>
      {expandButton}
    </Root>
  )
}
