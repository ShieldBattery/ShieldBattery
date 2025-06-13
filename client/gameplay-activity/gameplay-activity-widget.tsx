import { atom, useAtom } from 'jotai'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { useRoute } from 'wouter'
import { slotCount, takenSlotCount } from '../../common/lobbies'
import { urlPath } from '../../common/urls'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'
import { cancelFindMatch } from '../matchmaking/action-creators'
import { ElapsedTime } from '../matchmaking/elapsed-time'
import { OutlinedButton } from '../material/button'
import { Portal } from '../material/portal'
import { elevationPlus2 } from '../material/shadows'
import { zIndexDialogScrim } from '../material/zindex'
import { push } from '../navigation/routing'
import { useMultiplexRef } from '../react/refs'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  BodyLarge,
  BodyMedium,
  LabelMedium,
  singleLine,
  titleLarge,
  titleMedium,
} from '../styles/typography'

const gameplayActivityWidgetPositionAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 })

const PositioningArea = styled.div`
  position: fixed;
  left: 8px;
  right: 8px;
  top: calc(var(--sb-system-bar-height, 0) + 72px);
  bottom: 8px;

  contain: layout;
  pointer-events: none;
  z-index: ${zIndexDialogScrim - 1};
`

export function GameplayActivityWidget() {
  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const matchmakingSearchInfo = useAppSelector(s => s.matchmaking.searchInfo)

  const [onLobbyRoute] = useRoute('/lobbies/:lobby/*?')

  const positioningAreaRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<HTMLDivElement>(null)
  const [, setPosition] = useAtom(gameplayActivityWidgetPositionAtom)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const widget = widgetRef.current
    if (!widget) return
    const widgetRect = widget.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - widgetRect.left,
      y: e.clientY - widgetRect.top,
    })
    setDragging(true)
    e.preventDefault()
  }

  useEffect(() => {
    if (!dragging) {
      return () => {}
    }

    function onMouseMove(e: MouseEvent) {
      if (!positioningAreaRef.current) return
      const areaRect = positioningAreaRef.current.getBoundingClientRect()
      const x = e.clientX - areaRect.left - (dragOffset?.x ?? 0)
      const y = e.clientY - areaRect.top - (dragOffset?.y ?? 0)
      setPosition({ x, y })
    }
    function onMouseUp() {
      setDragging(false)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging, dragOffset, setPosition])

  let widget: React.ReactNode | undefined
  if (inLobby && !onLobbyRoute) {
    widget = <LobbyWidget ref={widgetRef} onDragStart={onDragStart} />
  } else if (matchmakingSearchInfo) {
    widget = <MatchmakingWidget ref={widgetRef} onDragStart={onDragStart} />
  }

  return (
    <Portal open={!!widget}>
      <PositioningArea ref={positioningAreaRef}>{widget}</PositioningArea>
    </Portal>
  )
}

const WidgetRoot = styled.div`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus2};

  position: absolute;
  left: var(--widget-left, 0px);
  top: var(--widget-top, 0px);
  max-width: 280px;

  padding-block: 8px;
  display: inline-block;
  border-radius: 8px;
  pointer-events: auto;
`

const WidgetTitleArea = styled.div<{ $hasPip?: boolean }>`
  position: relative;
  height: 24px;
  margin-bottom: 8px;
  padding-inline: 2px 12px;

  display: flex;
  align-items: center;
  gap: 4px;

  cursor: move;

  ${props => {
    if (props.$hasPip) {
      return css`
        &::after {
          content: '';
          position: absolute;
          width: 8px;
          height: 8px;
          right: 4px;
          top: 0px;

          background-color: var(--theme-amber);
          border-radius: 50%;
        }
      `
    } else {
      return css``
    }
  }}
`

const WidgetTitle = styled.div`
  ${titleMedium};
  ${singleLine};
`

const WidgetChildren = styled.div`
  padding-inline: 8px;

  display: flex;
  flex-direction: column;

  gap: 12px;
`

const DragHandle = styledWithAttrs(MaterialIcon, { icon: 'drag_indicator' })``

function Widget({
  ref,
  title,
  hasTitlePip = false,
  onDragStart,
  children,
}: {
  ref: React.Ref<HTMLDivElement>
  title: string
  hasTitlePip?: boolean
  onDragStart: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  const [position] = useAtom(gameplayActivityWidgetPositionAtom)
  const [sizeRef, contentRect] = useObservedDimensions<HTMLDivElement>()
  const composedRef = useMultiplexRef(ref, sizeRef)

  const width = contentRect?.width ?? 0
  const height = contentRect?.height ?? 0

  return (
    <WidgetRoot
      ref={composedRef}
      style={
        {
          '--widget-left': `clamp(0px, ${position.x}px, calc(100% - ${width}px))`,
          '--widget-top': `clamp(0px, ${position.y}px, calc(100% - ${height}px))`,
        } as React.CSSProperties
      }>
      <WidgetTitleArea onMouseDown={onDragStart} style={{ cursor: 'move' }} $hasPip={hasTitlePip}>
        <DragHandle />
        <WidgetTitle>{title}</WidgetTitle>
      </WidgetTitleArea>
      <WidgetChildren>{children}</WidgetChildren>
    </WidgetRoot>
  )
}

type WidgetContainerProps = Omit<React.ComponentProps<typeof Widget>, 'children' | 'title'>

const LobbyInfo = styled.div`
  display: grid;
  grid-template-columns: auto minmax(auto, 1fr);

  align-items: baseline;
  column-gap: 8px;
  row-gap: 4px;
`

export function LobbyWidget(props: WidgetContainerProps) {
  const { t } = useTranslation()
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const hasUnread = useAppSelector(s => s.lobby.hasUnread)
  const lobbyInfo = useAppSelector(s => s.lobby.info)
  const totalSlots = slotCount(lobbyInfo)
  const takenSlots = takenSlotCount(lobbyInfo)

  return (
    <Widget {...props} title={lobbyName} hasTitlePip={hasUnread}>
      <LobbyInfo>
        <LabelMedium>{t('gameplayActivity.lobby.slotsLabel', 'Slots:')}</LabelMedium>
        <BodyMedium>
          {t('gameplayActivity.lobby.slotCount', {
            defaultValue: '{{takenSlots}} / {{totalSlots}}',
            takenSlots,
            totalSlots,
          })}
        </BodyMedium>
      </LobbyInfo>
      <OutlinedButton
        iconStart={<MaterialIcon icon='arrow_forward' size={20} />}
        label={t('gameplayActivity.lobby.viewLobby', 'View lobby')}
        onClick={() => push(urlPath`/lobbies/${lobbyName}`)}
      />
    </Widget>
  )
}

const StyledElapsedTime = styled(ElapsedTime)`
  ${titleLarge};

  margin-top: 4px;

  font-feature-settings: 'tnum' on;
  text-align: center;
`

export function MatchmakingWidget(props: WidgetContainerProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isMatched = useAppSelector(s => !!s.matchmaking.match)
  const startTime = useAppSelector(s => s.matchmaking.searchInfo?.startTime)
  const isGameInProgress = useAppSelector(
    s => s.matchmaking.isLaunching || s.matchmaking.isCountingDown || s.matchmaking.isStarting,
  )

  if (isGameInProgress) {
    return null
  }

  return (
    <Widget
      {...props}
      title={
        isMatched
          ? t('gameplayActivity.matchmaking.matchFound', 'Match found!')
          : t('gameplayActivity.matchmaking.searching', 'Searching for a match…')
      }>
      {isMatched || startTime === undefined ? (
        <BodyLarge>…</BodyLarge>
      ) : (
        <StyledElapsedTime startTimeMs={startTime} />
      )}
      {!isMatched ? (
        <OutlinedButton
          iconStart={<MaterialIcon icon='close' size={20} />}
          label={t('common.actions.cancel', 'Cancel')}
          onClick={() => dispatch(cancelFindMatch())}
        />
      ) : null}
    </Widget>
  )
}
