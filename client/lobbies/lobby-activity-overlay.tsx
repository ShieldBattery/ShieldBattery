import { Immutable } from 'immer'
import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import { MapInfoJson } from '../../common/maps'
import { CreateLobby } from './create-lobby'
import JoinLobby from './join-lobby'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

export interface LobbyActivityOverlayProps {
  creating?: boolean
  map?: Immutable<MapInfoJson>
}

export function LobbyActivityOverlay({ creating = false, map }: LobbyActivityOverlayProps) {
  const [isCreating, setIsCreating] = useState(creating)
  const onNavigateToList = useCallback(() => {
    setIsCreating(false)
  }, [])
  const onNavigateToCreate = useCallback(() => {
    setIsCreating(true)
  }, [])

  return (
    <Container>
      {isCreating ? (
        <CreateLobby map={map} onNavigateToList={onNavigateToList} />
      ) : (
        <JoinLobby onNavigateToCreate={onNavigateToCreate} />
      )}
    </Container>
  )
}
