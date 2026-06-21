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
}

/**
 * Renders a user's per-mode rank cards, showing only their most-active modes by default with a toggle
 * to expand to every mode they've played. Shared by the profile page and the profile overlay; the
 * caller supplies how each card is rendered via `children`.
 */
export function ExpandableRankDisplays({
  ladder,
  children,
  className,
}: ExpandableRankDisplaysProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  const rankedTypes = getRankedTypesByActivity(ladder)
  const shownTypes = isExpanded ? rankedTypes : rankedTypes.slice(0, DEFAULT_PROFILE_RANKS_SHOWN)

  return (
    <Root className={className}>
      <Cards>
        {shownTypes.map(matchmakingType => (
          <React.Fragment key={matchmakingType}>
            {children(matchmakingType, ladder[matchmakingType]!)}
          </React.Fragment>
        ))}
      </Cards>
      {rankedTypes.length > DEFAULT_PROFILE_RANKS_SHOWN ? (
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
      ) : null}
    </Root>
  )
}
