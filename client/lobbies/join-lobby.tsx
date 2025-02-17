import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { gameTypeToLabel } from '../../common/games/configuration'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { MapThumbnail } from '../maps/map-thumbnail'
import { RaisedButton } from '../material/button'
import siteSocket from '../network/site-socket'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorDividers } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { Body1, Headline5, Headline6, Subtitle1, Subtitle2 } from '../styles/typography'
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
    border-top: 1px solid ${colorDividers};
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
        <Headline6>{lobby.name}</Headline6>
        <Subtitle2>{lobby.host.name}</Subtitle2>
        <Body1>{gameTypeToLabel(lobby.gameType, t)}</Body1>
        <Body1>
          {t('lobbies.joinLobby.openSlotCount', {
            defaultValue: '{{count}} slots open',
            count: lobby.openSlotCount,
          })}
        </Body1>
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
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isConnected = useAppSelector(s => s.network.isConnected)
  const lobbyList = useAppSelector(s => s.lobbyList)

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

  const handleLobbyClick = useCallback(
    (lobby: any) => {
      dispatch(joinLobby(lobby.name))
      navigateToLobby(lobby.name)
    },
    [dispatch],
  )

  const renderList = () => {
    const { byName, list } = lobbyList
    if (!list.size) {
      return (
        <div>
          <Subtitle1>
            {t('lobbies.joinLobby.noActiveLobbies', 'There are no active lobbies')}
          </Subtitle1>
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
          <Subtitle1>{t('lobbies.joinLobby.noOpenLobbies', 'There are no open lobbies')}</Subtitle1>
        )}
      </div>
    )
  }

  return (
    <Container>
      <TitleBar>
        <Headline5>{t('lobbies.joinLobby.title', 'Join Lobby')}</Headline5>
        <FlexSpacer />
        {IS_ELECTRON ? (
          <RaisedButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            iconStart={<MaterialIcon icon='add' />}
            onClick={onNavigateToCreate}
          />
        ) : undefined}
      </TitleBar>
      <Contents>
        <ContentsBody>{renderList()}</ContentsBody>
      </Contents>
    </Container>
  )
}

export default JoinLobby
