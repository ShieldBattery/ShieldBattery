import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { appendToMultimap } from '../../common/data-structures/maps'
import { LadderPlayer } from '../../common/ladder/ladder'
import { SeasonId } from '../../common/matchmaking'
import { SbUser } from '../../common/users/sb-user'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, titleLarge } from '../styles/typography'
import { getUserRankingHistory } from './action-creators'
import { UserRankDisplay } from './user-rank-display'

const Container = styled.div`
  padding: 0 24px;

  display: flex;
  flex-direction: column;
  gap: 48px;
`

const NoResults = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

export function UserProfileSeasons({ user }: { user: SbUser }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [ranks, setRanks] = useState<LadderPlayer[]>()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error>()

  useEffect(() => {
    setIsLoading(true)

    const abortController = new AbortController()

    dispatch(
      getUserRankingHistory(user.id, {
        signal: abortController.signal,
        onSuccess: data => {
          setIsLoading(false)
          setError(undefined)
          setRanks(data.history)
        },
        onError: err => {
          setIsLoading(false)
          setError(err)
        },
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [dispatch, user.id])

  if (isLoading) {
    return <LoadingDotsArea />
  } else if (error) {
    return (
      <Container>
        <ErrorText>
          {t('user.seasons.retrievingError', 'There was an error retrieving the ranking history.')}
        </ErrorText>
      </Container>
    )
  } else if (ranks?.length === 0) {
    return (
      <Container>
        <NoResults>
          {t('user.seasons.noMatchingGames', {
            defaultValue: '{{user}} has played no games in previous seasons.',
            user: user.name,
          })}
        </NoResults>
      </Container>
    )
  } else if (ranks) {
    const seasonIdToRanks = new Map<SeasonId, LadderPlayer[]>()
    for (const r of ranks) {
      appendToMultimap(seasonIdToRanks, r.seasonId, r)
    }

    return (
      <Container>
        {Array.from(seasonIdToRanks.entries()).map(([seasonId, seasonRanks]) => (
          <PastSeasonItem key={seasonId} seasonId={seasonId} seasonRanks={seasonRanks} />
        ))}
      </Container>
    )
  }
}

const SeasonHeader = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface);
  margin-bottom: 16px;
`

const RanksContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

function PastSeasonItem({
  seasonId,
  seasonRanks,
}: {
  seasonId: SeasonId
  seasonRanks: LadderPlayer[]
}) {
  const season = useAppSelector(state => state.matchmakingSeasons.byId.get(seasonId))
  if (!season) {
    return null
  }

  return (
    <div>
      <SeasonHeader>{season.name}</SeasonHeader>
      <RanksContainer>
        {seasonRanks.map(rank => (
          <UserRankDisplay
            key={rank.matchmakingType}
            matchmakingType={rank.matchmakingType}
            ladderPlayer={rank}
            season={season}
          />
        ))}
      </RanksContainer>
    </div>
  )
}
