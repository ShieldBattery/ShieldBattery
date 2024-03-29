import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { useTrackPageView } from '../analytics/analytics'
import { CreateLobby } from './create-lobby'
import JoinLobby from './join-lobby'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

export interface LobbyActivityOverlayProps {
  creating?: boolean
  initName?: string
  map?: ReadonlyDeep<MapInfoJson>
}

export function LobbyActivityOverlay({
  creating = false,
  map,
  initName,
}: LobbyActivityOverlayProps) {
  const [isCreating, setIsCreating] = useState(creating)
  const onNavigateToList = useCallback(() => {
    setIsCreating(false)
  }, [])
  const onNavigateToCreate = useCallback(() => {
    setIsCreating(true)
  }, [])

  useTrackPageView(isCreating ? '/lobbies/create' : '/lobbies')

  return (
    <Container>
      {isCreating ? (
        <CreateLobby mapId={map?.id} onNavigateToList={onNavigateToList} initName={initName} />
      ) : (
        <JoinLobby onNavigateToCreate={onNavigateToCreate} />
      )}
    </Container>
  )
}
