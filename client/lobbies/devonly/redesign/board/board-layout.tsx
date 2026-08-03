import styled from 'styled-components'
import { ScenarioData, ViewerRole } from '../mock-data'
import { BoardChat } from './board-chat'
import { deriveBoardModel, StartModel } from './board-model'
import { LaunchRail } from './launch-rail'
import { MapHero } from './map-hero'
import { PresenceWidget } from './presence-widget'
import { SlotBoard } from './slot-board'

const BoardArea = styled.div`
  width: 100%;
  max-width: 1200px;
  min-height: 100%;
  padding: 16px 20px 24px;
  margin-inline: auto;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const LowerRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
`

const MainStack = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

/**
 * The Board variant's main column: a map hero, the slot board under it, and the lobby's chat kept
 * below-left of the seats. The social sidebar stays untouched beside all of it — this variant's
 * answer to Q2 is that the lobby is a place you visit, not another chat surface.
 */
export function BoardLayout({
  data,
  viewer,
  startModel,
}: {
  data: ScenarioData
  viewer: ViewerRole
  startModel: StartModel
}) {
  const model = deriveBoardModel(data, viewer, startModel)

  return (
    <BoardArea>
      <MapHero model={model} />
      <LowerRow>
        <MainStack>
          <SlotBoard model={model} />
          <BoardChat model={model} />
        </MainStack>
        <LaunchRail model={model} />
      </LowerRow>
      <PresenceWidget model={model} />
    </BoardArea>
  )
}
