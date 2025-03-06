import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { gameTypeToLabel } from '../../common/games/game-type'
import { useTrackPageView } from '../analytics/analytics'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { MapThumbnail } from '../maps/map-thumbnail'
import { ElevatedButton } from '../material/button'
import siteSocket from '../network/site-socket'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { FlexSpacer } from '../styles/flex-spacer'
import { BodyLarge, BodyMedium, TitleLarge, TitleMedium } from '../styles/typography'
import { joinLobby, navigateToLobby } from './action-creators'

const ListEntryRoot = styled.div`
  width: 100%;
  padding-left: 16px;
  padding-right: 16px;
  padding-bottom: 7px;

  display: flex;
  align-items: center;

  &:hover {
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.08);
  }

  &:first-child {
    padding-top: 8px;
  }

  &:last-child {
    padding-bottom: 8px;
  }

  & + & {
    padding-top: 8px;
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const Info = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`

const MapPreview = styled.div`
  width: 128px;
  height: 128px;
  position: relative;

  flex-shrink: 0;
  margin-left: 8px;
`

interface ListEntryProps {
  lobby: any
  onClick: (lobby: any) => void
}

function ListEntry({ lobby, onClick }: ListEntryProps) {
  const { t } = useTranslation()

  return (
    <ListEntryRoot onClick={() => onClick(lobby)}>
      <Info>
        <TitleLarge>{lobby.name}</TitleLarge>
        <TitleMedium>{lobby.host.name}</TitleMedium>
        <BodyMedium>{gameTypeToLabel(lobby.gameType, t)}</BodyMedium>
        <BodyMedium>
          {t('lobbies.joinLobby.openSlotCount', {
            defaultValue: '{{count}} slots open',
            count: lobby.openSlotCount,
          })}
        </BodyMedium>
      </Info>
      <MapPreview>
        <MapThumbnail map={lobby.map} showMapName={true} />
      </MapPreview>
    </ListEntryRoot>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
`

const TitleBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 16px 24px;
`

const Contents = styled.div`
  position: relative;
  flex-grow: 1;
`

const ContentsBody = styled.div`
  padding: 12px 24px;
`

interface JoinLobbyProps {
  onNavigateToCreate: () => void
}

function JoinLobby({ onNavigateToCreate }: JoinLobbyProps) {
  useTrackPageView('/lobbies')
  const { t } = useTranslation()
  const isConnected = useAppSelector(s => s.network.isConnected)

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

  return (
    <Container>
      <TitleBar>
        <TitleLarge>{t('lobbies.joinLobby.title', 'Join Lobby')}</TitleLarge>
        <FlexSpacer />
        {IS_ELECTRON ? (
          <ElevatedButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            iconStart={<MaterialIcon icon='add' />}
            onClick={onNavigateToCreate}
          />
        ) : undefined}
      </TitleBar>
      <Contents>
        <ContentsBody>
          <LobbyList />
        </ContentsBody>
      </Contents>
    </Container>
  )
}

function LobbyList() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { byName, list } = useAppSelector(s => s.lobbyList)

  const handleLobbyClick = useCallback(
    (lobby: any) => {
      if (IS_ELECTRON) {
        dispatch(joinLobby(lobby.name))
        navigateToLobby(lobby.name)
      } else {
        dispatch(openDialog({ type: DialogType.Download }))
      }
    },
    [dispatch],
  )

  if (!list.size) {
    return (
      <div>
        <BodyLarge>
          {t('lobbies.joinLobby.noActiveLobbies', 'There are no active lobbies')}
        </BodyLarge>
      </div>
    )
  }

  const openLobbies = list.filter(name => (byName.get(name)?.openSlotCount ?? 0) > 0)
  return (
    <div>
      {!openLobbies.isEmpty() ? (
        openLobbies.map(name => (
          <ListEntry key={name} lobby={byName.get(name)} onClick={handleLobbyClick} />
        ))
      ) : (
        <BodyLarge>{t('lobbies.joinLobby.noOpenLobbies', 'There are no open lobbies')}</BodyLarge>
      )}
    </div>
  )
}

export default JoinLobby
