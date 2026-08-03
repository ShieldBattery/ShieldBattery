import styled from 'styled-components'
import { ExplorationFrame } from './exploration-frame'
import { RoomChat } from './room/room-chat'
import { RoomHeader } from './room/room-header'
import { getRoomViewer } from './room/room-model'
import { RoomSidebarEntry } from './room/room-sidebar-entry'
import { SlotRail } from './room/slot-rail'

const Root = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;

  overflow: hidden;
`

const Body = styled.div`
  flex-grow: 1;
  min-height: 0;

  display: flex;
`

/**
 * The "Room" variant of the in-lobby redesign (Q2: the lobby is a chat surface docked into the
 * app's social model). Lobby chat is the whole main column, the slot board is a collapsible rail
 * beside it, and the lobby holds a first-class entry in the social sidebar so a member keeps their
 * room in view from anywhere else in the app — no floating widget involved.
 */
export default function RoomExploration() {
  return (
    <ExplorationFrame
      sidebarSlot={(data, role) => (
        <RoomSidebarEntry data={data} viewer={getRoomViewer(data, role)} />
      )}>
      {(data, role) => {
        const viewer = getRoomViewer(data, role)
        return (
          <Root>
            <RoomHeader data={data} viewer={viewer} />
            <Body>
              <RoomChat data={data} viewer={viewer} />
              <SlotRail data={data} viewer={viewer} />
            </Body>
          </Root>
        )
      }}
    </ExplorationFrame>
  )
}
