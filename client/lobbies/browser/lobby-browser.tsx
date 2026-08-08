import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../../common/errors'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { useTrackPageView } from '../../analytics/analytics'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { isMatchmakingAtom } from '../../matchmaking/matchmaking-atoms'
import { FilledButton, TextButton } from '../../material/button'
import siteSocket from '../../network/site-socket'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useRelationshipsLoader } from '../../social/friends-list'
import { healthChecked } from '../../starcraft/health-checked'
import { FlexSpacer } from '../../styles/flex-spacer'
import { bodyLarge, bodyMedium, titleLarge } from '../../styles/typography'
import { LobbyBrowserFilters, useLobbyBrowserFilterState } from './lobby-browser-filters'
import { LobbyDetailRail } from './lobby-detail-rail'
import { LobbyRow } from './lobby-row'
import {
  compareSummaries,
  friendsInLobby,
  lobbyListStats,
  lobbyMatchesSearch,
  LobbySummary,
} from './summary-utils'

/**
 * Stands in for the user store while no search is running, so the browser only subscribes to user
 * updates when it actually reads names out of them.
 */
const NO_USERS: ReadonlyMap<SbUserId, SbUser> = new Map()

const Root = styled.div`
  height: 100%;
  /* This page is a grid item in the play area's layout, whose track minimum defaults to its
     content's min-content size. The fixed-width rail plus the rows' no-wrap text give that
     content a floor of its own (~950px) unless a min-width overrides it, so without this the page
     gets clipped at the track's edge instead of shrinking below that floor. */
  min-width: 0;
  padding: 16px 0 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const TitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const PageTitle = styled.div`
  ${titleLarge};
`

const StatLine = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Panes = styled.div`
  flex-grow: 1;
  min-height: 0;

  display: flex;
  align-items: stretch;
  gap: 24px;
`

const ListPane = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;

  overflow-y: auto;
  /* Keeps the rows' hover fill off the scrollbar. */
  padding-right: 4px;
`

const EmptyState = styled.div`
  ${bodyLarge};

  flex-grow: 1;
  min-height: 240px;
  padding: 32px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const EmptyStateActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export interface LobbyBrowserProps {
  onNavigateToCreate: () => void
}

/**
 * The lobby browser: everything open right now down the left, and a live preview of whichever one
 * you're looking at down the right. The preview keeps updating from the same list channel that
 * feeds the rows, so seats fill while you decide.
 */
export function LobbyBrowser({ onNavigateToCreate }: LobbyBrowserProps) {
  useTrackPageView('/lobbies')
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isConnected = useAppSelector(s => s.network.isConnected)
  const isMatchmaking = useAtomValue(isMatchmakingAtom)

  useRelationshipsLoader()

  useEffect(() => {
    if (!isConnected) {
      return () => {}
    }

    siteSocket.invoke('/lobbies/subscribe').catch(err => {
      logger.error(`Failed to subscribe to lobbies list: ${getErrorStack(err)}`)
    })
    return () => {
      siteSocket.invoke('/lobbies/unsubscribe').catch(err => {
        logger.warning(`Failed to unsubscribe from lobbies: ${getErrorStack(err)}`)
      })
    }
  }, [isConnected])

  const filterState = useLobbyBrowserFilterState()
  const { gameType, friendsOnly, showFull, sort, searchQuery } = filterState

  const lobbyList = useAppSelector(s => s.lobbyList.list)
  const lobbiesById = useAppSelector(s => s.lobbyList.byId)
  const friends = useAppSelector(s => s.relationships.friends)
  // Host names are only needed to answer a search, so this stays out of the way otherwise.
  const usersById = useAppSelector(s => (searchQuery ? s.users.byId : NO_USERS))

  const summaries: LobbySummary[] = []
  for (const id of lobbyList) {
    const summary = lobbiesById.get(id)
    if (summary) {
      summaries.push(summary)
    }
  }

  const friendIdsByLobby = new Map<SbLobbyId, SbUserId[]>(
    summaries.map(summary => [summary.id, friendsInLobby(summary, friends)]),
  )

  const visible = summaries
    .filter(summary => {
      // Full gathering lobbies hide by default; the Full chip on the row reveals them once the
      // viewer opts in via the filter.
      if (!showFull && summary.openSlotCount === 0) {
        return false
      }
      if (gameType !== undefined && summary.gameType !== gameType) {
        return false
      }
      if (friendsOnly && !friendIdsByLobby.get(summary.id)?.length) {
        return false
      }
      return lobbyMatchesSearch(summary, searchQuery, usersById.get(summary.host.id)?.name)
    })
    .sort((a, b) => compareSummaries(a, b, sort))

  const [clickedId, setClickedId] = useState<SbLobbyId>()
  // A click holds the selection until that lobby leaves the visible list (it filled up, its game
  // started, it was filtered out), at which point the top of the list takes over again.
  const selectedId = visible.some(summary => summary.id === clickedId) ? clickedId : visible[0]?.id
  const selected = selectedId !== undefined ? lobbiesById.get(selectedId) : undefined

  const stats = lobbyListStats(summaries)
  const canCreate = IS_ELECTRON

  let panes: React.ReactNode
  if (summaries.length === 0) {
    panes = (
      <EmptyState>
        <div>{t('lobbies.browser.emptyNoLobbies', "No one's hosting right now")}</div>
        {canCreate ? (
          <FilledButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            iconStart={<MaterialIcon icon='add' size={20} />}
            disabled={isMatchmaking}
            onClick={healthChecked(onNavigateToCreate)}
          />
        ) : (
          <FilledButton
            label={t('clientDownload.download', 'Download')}
            iconStart={<MaterialIcon icon='download' size={20} />}
            onClick={() => dispatch(openDialog({ type: DialogType.Download }))}
          />
        )}
      </EmptyState>
    )
  } else if (visible.length === 0) {
    // With nothing filtered, the only thing that can empty a non-empty list is the default of
    // hiding lobbies nobody can get into, so say that rather than blaming filters that aren't set.
    panes = (
      <EmptyState>
        <div>
          {filterState.hasActiveFilters
            ? t('lobbies.browser.emptyNoMatches', 'No lobbies match your filters')
            : t('lobbies.browser.emptyAllFull', 'Every lobby is full right now')}
        </div>
        <EmptyStateActions>
          {filterState.hasActiveFilters ? (
            <TextButton
              label={t('common.actions.clear', 'Clear')}
              iconStart={<MaterialIcon icon='close' />}
              onClick={filterState.clearFilters}
            />
          ) : null}
          {!showFull ? (
            <TextButton
              label={t('lobbies.browser.showFullLobbies', 'Show full lobbies')}
              iconStart={<MaterialIcon icon='groups' />}
              onClick={() => filterState.setShowFull(true)}
            />
          ) : null}
        </EmptyStateActions>
      </EmptyState>
    )
  } else {
    panes = (
      <>
        <ListPane>
          {visible.map(summary => (
            <LobbyRow
              key={summary.id}
              summary={summary}
              selected={summary.id === selectedId}
              friendIds={friendIdsByLobby.get(summary.id) ?? []}
              onSelect={() => setClickedId(summary.id)}
            />
          ))}
        </ListPane>
        <LobbyDetailRail
          key={selectedId ?? 'none'}
          summary={selected}
          friendIds={(selectedId && friendIdsByLobby.get(selectedId)) || []}
        />
      </>
    )
  }

  return (
    <Root>
      <Header>
        <TitleBlock>
          <PageTitle>{t('lobbies.browser.title', 'Lobbies')}</PageTitle>
          <StatLine>
            {t('lobbies.browser.statLobbies', {
              defaultValue: '{{count}} lobbies',
              // eslint-disable-next-line camelcase -- i18next's plural-form key convention
              defaultValue_one: '{{count}} lobby',
              count: stats.lobbies,
            })}
            {' · '}
            {t('lobbies.browser.statPlayers', {
              defaultValue: '{{count}} players',
              // eslint-disable-next-line camelcase -- i18next's plural-form key convention
              defaultValue_one: '{{count}} player',
              count: stats.players,
            })}
          </StatLine>
        </TitleBlock>
        <FlexSpacer />
        {canCreate ? (
          <FilledButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            iconStart={<MaterialIcon icon='add' size={20} />}
            disabled={isMatchmaking}
            title={
              isMatchmaking
                ? t(
                    'lobbies.browser.createDisabledWhileMatchmaking',
                    'You cannot create a lobby while a matchmaking search is active.',
                  )
                : undefined
            }
            onClick={healthChecked(onNavigateToCreate)}
            testName='create-lobby-button'
          />
        ) : undefined}
      </Header>

      <LobbyBrowserFilters filterState={filterState} />

      <Panes>{panes}</Panes>
    </Root>
  )
}
