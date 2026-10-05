import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import {
  GameRecordJson,
  getGameTypeLabel,
  GetPendingReviewRequestsResponse,
} from '../../common/games/games'
import { MapInfoJson } from '../../common/maps'
import { apiUrl } from '../../common/urls'
import { NarrowDuration } from '../i18n/date-formats'
import logger from '../logging/logger'
import { FilledButton } from '../material/button'
import { push } from '../navigation/routing'
import { fetchJson } from '../network/fetch'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge, titleLarge } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { getGameResultsUrl } from './action-creators'

const Content = styled.div`
  max-width: 960px;
  margin: 0 16px;
  overflow-y: auto;
`

const PageHeadline = styled.div`
  ${titleLarge};
`

const HeadlineAndButton = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const EmptyText = styled.div`
  ${bodyLarge};
  padding: 16px;
  color: var(--theme-on-surface-variant);
`

const RequestTable = styled.div`
  width: 100%;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const TableRow = styled.div`
  height: 36px;

  display: flex;
  align-items: center;

  cursor: pointer;

  &:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }
`

const TableHeader = styled(TableRow)`
  cursor: default;
  font-weight: 500;
`

const TableCell = styled.div`
  height: 100%;
  padding: 8px 16px;

  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const DateCell = styled(TableCell)`
  width: 112px;
  flex-grow: 0;
  flex-shrink: 0;
`

const TypeCell = styled(TableCell)`
  width: 160px;
  flex-grow: 0;
  flex-shrink: 0;
`

const MapCell = styled(TableCell)`
  width: 180px;
  flex-grow: 0;
  flex-shrink: 0;
`

const PlayersCell = styled(TableCell)`
  flex-grow: 1;
`

/**
 * Lists the disputed matchmaking games whose players asked for an admin to review the results,
 * newest request first. Each row links to the game's page, where it can be resolved or the request
 * dismissed.
 */
export function AdminReviewRequests() {
  const [response, setResponse] = useState<GetPendingReviewRequestsResponse>()
  const [error, setError] = useState<Error>()
  const [isLoading, setIsLoading] = useState(true)
  // Bumped on refresh to re-run the fetch.
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const abortController = new AbortController()
    fetchJson<GetPendingReviewRequestsResponse>(apiUrl`games/review-requests`, {
      signal: abortController.signal,
    })
      .then(result => {
        setResponse(result)
        setError(undefined)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (abortController.signal.aborted) {
          return
        }
        logger.error(`Error loading review requests: ${getErrorStack(err)}`)
        setError(err as Error)
        setIsLoading(false)
      })

    return () => abortController.abort()
  }, [refreshToken])

  const mapsById = new Map(response?.maps.map(m => [m.id, m]))

  return (
    <Content>
      <HeadlineAndButton>
        <PageHeadline>Review requests</PageHeadline>
        <FilledButton
          label='Refresh'
          onClick={() => {
            setIsLoading(true)
            setRefreshToken(t => t + 1)
          }}
        />
      </HeadlineAndButton>
      <RequestTable>
        <TableHeader>
          <DateCell>Requested</DateCell>
          <DateCell>Played</DateCell>
          <TypeCell>Type</TypeCell>
          <MapCell>Map</MapCell>
          <PlayersCell>Players</PlayersCell>
        </TableHeader>
        {response?.requests.map(r => (
          <RequestRow
            key={r.game.id}
            game={r.game}
            requestedAt={r.requestedAt}
            map={mapsById.get(r.game.mapId)}
          />
        ))}
        {response && !response.requests.length ? (
          <EmptyText>No games are waiting for a review.</EmptyText>
        ) : null}
        {isLoading ? <LoadingDotsArea /> : null}
        {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      </RequestTable>
    </Content>
  )
}

function RequestRow({
  game,
  requestedAt,
  map,
}: {
  game: ReadonlyDeep<GameRecordJson>
  requestedAt: number
  map: ReadonlyDeep<MapInfoJson> | undefined
}) {
  const { t } = useTranslation()
  const teams = game.config.teams.map(team => team.filter(p => !p.isComputer))

  return (
    <TableRow onClick={() => push(getGameResultsUrl(game.id))}>
      <DateCell>
        <NarrowDuration to={requestedAt} />
      </DateCell>
      <DateCell>
        <NarrowDuration to={game.startTime} />
      </DateCell>
      <TypeCell>{getGameTypeLabel(game, t)}</TypeCell>
      <MapCell>{map?.name ?? 'Unknown map'}</MapCell>
      <PlayersCell>
        {/* Clicks on a name open its profile overlay rather than the game. */}
        <span onClick={e => e.stopPropagation()}>
          {teams.map((team, teamIndex) => (
            <span key={teamIndex}>
              {teamIndex > 0 ? ' vs ' : null}
              {team.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? ', ' : null}
                  <ConnectedUsername userId={p.id} />
                </span>
              ))}
            </span>
          ))}
        </span>
      </PlayersCell>
    </TableRow>
  )
}
