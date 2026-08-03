import { useState } from 'react'
import styled from 'styled-components'
import { labelMedium, labelSmall } from '../../../styles/typography'
import { BoardLayout } from './board/board-layout'
import { StartModel } from './board/board-model'
import { ExplorationFrame } from './exploration-frame'

const START_MODELS: ReadonlyArray<{ id: StartModel; label: string }> = [
  { id: 'countdown', label: 'Countdown' },
  { id: 'readyChecks', label: 'Ready checks' },
]

const PageRoot = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
`

/**
 * Deliberately styled as tooling rather than lobby chrome: it switches between two candidate
 * designs, so it must never read as part of either one.
 */
const DevBar = styled.div`
  flex-shrink: 0;
  padding: 8px 16px;
  margin: 8px 16px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;

  border: 1px dashed rgb(from var(--theme-amber) r g b / 0.7);
  border-radius: 8px;
  background-color: rgb(from var(--theme-amber) r g b / 0.06);
`

const DevTag = styled.div`
  ${labelSmall};
  padding: 2px 8px;

  border-radius: 4px;
  background-color: rgb(from var(--theme-amber) r g b / 0.2);
  color: var(--theme-amber);
  text-transform: uppercase;
  letter-spacing: 0.1em;
`

const DevLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface);
`

const Segmented = styled.div`
  display: flex;
  border: 1px solid var(--theme-outline);
  border-radius: 6px;
  contain: paint;
`

const SegmentButton = styled.button<{ $active: boolean }>`
  ${labelMedium};
  height: 28px;
  padding-inline: 12px;

  background-color: ${props =>
    props.$active ? 'rgb(from var(--theme-amber) r g b / 0.24)' : 'transparent'};
  border: none;
  color: ${props => (props.$active ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
  cursor: pointer;

  & + & {
    border-left: 1px solid var(--theme-outline);
  }
`

const DevNote = styled.div`
  ${labelSmall};
  flex-basis: 100%;
  color: var(--theme-on-surface-variant);
`

const FrameArea = styled.div`
  flex-grow: 1;
  min-height: 0;
`

/**
 * Variant 2 of the in-lobby redesign explorations — "Board": the lobby is a place you visit, built
 * around a map hero and a war-room slot board, with chat as a generous but secondary panel below
 * it. The app's social sidebar is left completely alone (this page never fills the frame's
 * `sidebarSlot`), which is this variant's answer to Q2; presence while you're elsewhere in the app
 * is the floating widget the board renders in the corner instead.
 *
 * The page also carries the Q3 start-model toggle: the classic host-driven countdown, or per-player
 * ready checks. Everything here is presentational — actions log and nothing else.
 */
export default function BoardExploration() {
  const [startModel, setStartModel] = useState<StartModel>('countdown')

  return (
    <PageRoot>
      <DevBar>
        <DevTag>Dev only</DevTag>
        <DevLabel>Start model (Q3)</DevLabel>
        <Segmented>
          {START_MODELS.map(option => (
            <SegmentButton
              key={option.id}
              $active={startModel === option.id}
              onClick={() => setStartModel(option.id)}>
              {option.label}
            </SegmentButton>
          ))}
        </Segmented>
        <DevNote>
          Countdown: the host starts the game and a shared timer runs down. Ready checks: every
          seated player readies up first, a settings change clears everyone's readiness, and the
          host's button becomes a force start.
        </DevNote>
      </DevBar>
      <FrameArea>
        <ExplorationFrame>
          {(data, viewer) => <BoardLayout data={data} viewer={viewer} startModel={startModel} />}
        </ExplorationFrame>
      </FrameArea>
    </PageRoot>
  )
}
