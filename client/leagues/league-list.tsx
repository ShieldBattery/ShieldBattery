import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { Link } from 'wouter'
import { ClientLeagueUserJson, LeagueId, LeagueJson } from '../../common/leagues/leagues'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useTrackPageView } from '../analytics/analytics'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import logger from '../logging/logger'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { FlexSpacer } from '../styles/flex-spacer'
import { bodyLarge, bodyMedium, headlineMedium, labelLarge } from '../styles/typography'
import { getLeaguesList, urlForLeague } from './action-creators'
import { LeagueCard } from './league-card'
import { LeagueSectionType } from './league-section-type'

const ListRoot = styled.div`
  width: 100%;
  padding: 24px 0 12px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const TitleRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 16px;
`

const Title = styled.div`
  ${headlineMedium};
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export function LeagueList() {
  useTrackPageView('/leagues/')
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isAdmin = useHasAnyPermission('manageLeagues')
  const { past, current, future, byId, selfLeagues } = useAppSelector(s => s.leagues)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error>()

  const { pastLeagues, currentLeagues, futureLeagues } = useMemo(() => {
    const pastLeagues = past.map(id => byId.get(id)!)
    const currentLeagues = current.map(id => byId.get(id)!)
    const futureLeagues = future.map(id => byId.get(id)!)

    return { pastLeagues, currentLeagues, futureLeagues }
  }, [past, current, future, byId])

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    setIsLoading(true)

    dispatch(
      getLeaguesList({
        signal,
        onSuccess(res) {
          setIsLoading(false)
          setError(undefined)
        },
        onError(err) {
          setIsLoading(false)
          setError(err)
          logger.error(`Error loading leagues list: ${String(err.stack ?? err)}`)
        },
      }),
    )

    return () => controller.abort()
  }, [dispatch])

  return (
    <CenteredContentContainer>
      <ListRoot>
        <TitleRow>
          <Title>{t('leagues.list.pageHeadline', 'Leagues')}</Title>
          {isAdmin ? (
            <Link href='/leagues/admin'>{t('leagues.list.manageLeagues', 'Manage leagues')}</Link>
          ) : null}
          <FlexSpacer />
          <Link
            href='#'
            onClick={event => {
              event.preventDefault()
              dispatch(
                openDialog({
                  type: DialogType.LeagueExplainer,
                }),
              )
            }}>
            {t('leagues.list.howDoLeaguesWork', 'How do leagues work?')}
          </Link>
        </TitleRow>

        {!isLoading && error ? (
          <ErrorText>{t('leagues.list.loadingError', 'Error loading leagues')}</ErrorText>
        ) : null}

        {!isLoading || currentLeagues.length ? (
          <LeagueSection
            label={t('leagues.list.currentlyRunning', 'Currently running')}
            leagues={currentLeagues}
            joinedLeagues={selfLeagues}
            type={LeagueSectionType.Current}
          />
        ) : undefined}
        {futureLeagues.length ? (
          <LeagueSection
            label={t('leagues.list.acceptingSignups', 'Accepting signups')}
            leagues={futureLeagues}
            joinedLeagues={selfLeagues}
            type={LeagueSectionType.Future}
          />
        ) : null}
        {pastLeagues.length ? (
          <LeagueSection
            label={t('leagues.list.finished', 'Finished')}
            leagues={pastLeagues}
            joinedLeagues={selfLeagues}
            type={LeagueSectionType.Past}
          />
        ) : null}

        {isLoading ? <LoadingDotsArea /> : null}
      </ListRoot>
    </CenteredContentContainer>
  )
}

const SectionRoot = styled.div`
  & + & {
    margin-top: 32px;
  }
`

const SectionLabel = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const SectionCards = styled.div`
  padding-top: 8px;

  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const EmptyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

function LeagueSection({
  label,
  leagues,
  joinedLeagues,
  type,
}: {
  label: string
  leagues: Array<ReadonlyDeep<LeagueJson>>
  joinedLeagues: ReadonlyDeep<Map<LeagueId, ClientLeagueUserJson>>
  type: LeagueSectionType
}) {
  const { t } = useTranslation()
  const curDate = Date.now()

  return (
    <SectionRoot>
      <SectionLabel>{label}</SectionLabel>
      <SectionCards>
        {leagues.length ? (
          leagues.map(l => (
            <LeagueCard
              key={l.id}
              league={l}
              type={type}
              curDate={curDate}
              joined={joinedLeagues.has(l.id)}
              actionText={t('leagues.list.viewInfo', 'View info')}
              href={urlForLeague(l.id, l)}
            />
          ))
        ) : (
          <EmptyText>{t('leagues.list.noLeagues', 'No matching leagues')}</EmptyText>
        )}
      </SectionCards>
    </SectionRoot>
  )
}
