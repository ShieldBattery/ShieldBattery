import { atom, useAtom, useAtomValue } from 'jotai'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { Except } from 'type-fest'
import { useRoute } from 'wouter'
import { slotCount, takenSlotCount } from '../../common/lobbies'
import { urlForLobby } from '../../common/lobbies/lobby-url'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'
import { isInLobby } from '../lobbies/lobby-reducer'
import { JsonLocalStorageValue } from '../local-storage'
import {
  cancelFindMatch,
  openAcceptMatchDialog,
  simulateMatchPop,
} from '../matchmaking/action-creators'
import { isInDraftAtom } from '../matchmaking/draft-atoms'
import { ElapsedTime } from '../matchmaking/elapsed-time'
import {
  currentSearchInfoAtom,
  foundMatchAtom,
  hasAcceptedAtom,
  isMatchmakingAtom,
  matchLaunchingAtom,
} from '../matchmaking/matchmaking-atoms'
import { useAcceptCountdown } from '../matchmaking/use-accept-countdown'
import { useAcceptMatch } from '../matchmaking/use-accept-match'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { Portal } from '../material/portal'
import { elevationPlus2 } from '../material/shadows'
import { zIndexGameplayActivity } from '../material/zindex'
import { MessagePreviewLine } from '../messaging/message-preview-line'
import { CommonMessageType, CommonTextMessage } from '../messaging/message-records'
import { push } from '../navigation/routing'
import { isConnectedAtom } from '../network/network-atoms'
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
import { anchorWidgetPosition, parseWidgetPosition, WidgetPosition } from './widget-position'

/** The widget's position, kept per machine so it comes back where the user parked it. */
const savedWidgetPosition = new JsonLocalStorageValue<WidgetPosition>(
  'gameplayActivityWidgetPosition',
)

const widgetPositionAtom = atom<WidgetPosition>(parseWidgetPosition(savedWidgetPosition.getValue()))

/** The size the widget's placement is clamped with, as `Widget` measures it onto the element. */
function placementSize(widget: HTMLElement) {
  return {
    width: parseFloat(widget.style.getPropertyValue('--_width')) || 0,
    height: parseFloat(widget.style.getPropertyValue('--_height')) || 0,
  }
}

const PositioningArea = styled.div`
  position: fixed;
  left: 8px;
  right: 8px;
  top: calc(var(--sb-system-bar-height, 0) + 72px);
  bottom: 8px;

  contain: layout;
  pointer-events: none;
  z-index: ${zIndexGameplayActivity};
`

interface WidgetDrag {
  widget: HTMLElement
  /** Where the widget was grabbed, relative to its top-left corner. */
  offsetX: number
  offsetY: number
}

export function GameplayActivityWidget() {
  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const isMatchmaking = useAtomValue(isMatchmakingAtom)
  const inDraft = useAtomValue(isInDraftAtom)
  const isConnected = useAtomValue(isConnectedAtom)
  const isMatchLaunching = useAtomValue(matchLaunchingAtom)

  const [onLobbyRoute] = useRoute('/lobbies/:lobbyId/*?')

  const positioningAreaRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useAtom(widgetPositionAtom)
  const [drag, setDrag] = useState<WidgetDrag>()

  const onDragStart = (e: React.MouseEvent, widget: HTMLElement) => {
    if (e.button !== 0) return
    const widgetRect = widget.getBoundingClientRect()
    setDrag({
      widget,
      offsetX: e.clientX - widgetRect.left,
      offsetY: e.clientY - widgetRect.top,
    })
    e.preventDefault()
  }

  useEffect(() => {
    if (!drag) {
      return () => {}
    }
    const { widget, offsetX, offsetY } = drag

    // The position as last rendered, saved once when the drag ends rather than on every move
    let latest: WidgetPosition | undefined

    function onMouseMove(e: MouseEvent) {
      const area = positioningAreaRef.current
      if (!area) return
      const areaRect = area.getBoundingClientRect()
      latest = anchorWidgetPosition(
        {
          left: e.clientX - areaRect.left - offsetX,
          top: e.clientY - areaRect.top - offsetY,
        },
        areaRect,
        placementSize(widget),
      )
      setPosition(latest)
    }
    function onMouseUp() {
      if (latest) {
        savedWidgetPosition.setValue(latest)
      }
      setDrag(undefined)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [drag, setPosition])

  let kind: 'lobby' | 'matchmaking' | undefined
  if (isConnected && inLobby && !onLobbyRoute) {
    kind = 'lobby'
  } else if (isConnected && isMatchmaking && !inDraft && !isMatchLaunching) {
    kind = 'matchmaking'
  }

  // Each appearance of a widget gets its own key, so one that returns while its predecessor is
  // still exiting is a new element rather than the exiting one brought back. An exit can't finish
  // while the document is hidden, and motion leaves an element that exits and returns in that time
  // at the exit's opacity for good.
  const [appearance, setAppearance] = useState({ kind, id: 0 })
  if (appearance.kind !== kind) {
    setAppearance({ kind, id: appearance.id + 1 })
  }

  let widget: React.ReactNode | undefined
  if (kind === 'lobby') {
    widget = <LobbyWidget key={appearance.id} onDragStart={onDragStart} />
  } else if (kind === 'matchmaking') {
    widget = <MatchmakingWidget key={appearance.id} onDragStart={onDragStart} />
  }

  return (
    <Portal open={!!widget}>
      <PositioningArea
        ref={positioningAreaRef}
        style={
          {
            // Only the variable for the edge the widget is anchored to is set; the widget's own
            // placement falls back to measuring from the opposite edge when the start one is unset.
            '--widget-left': position.x.edge === 'start' ? `${position.x.offset}px` : undefined,
            '--widget-right': position.x.edge === 'end' ? `${position.x.offset}px` : undefined,
            '--widget-top': position.y.edge === 'start' ? `${position.y.offset}px` : undefined,
            '--widget-bottom': position.y.edge === 'end' ? `${position.y.offset}px` : undefined,
          } as React.CSSProperties
        }>
        <AnimatePresence>{widget}</AnimatePresence>
      </PositioningArea>
    </Portal>
  )
}

const WidgetRoot = styled(m.div)`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus2};

  position: absolute;
  left: clamp(
    0px,
    var(--widget-left, calc(100% - var(--_width, 0px) - var(--widget-right, 0px))),
    calc(100% - var(--_width, 0px))
  );
  top: clamp(
    0px,
    var(--widget-top, calc(100% - var(--_height, 0px) - var(--widget-bottom, 0px))),
    calc(100% - var(--_height, 0px))
  );
  /* An absolutely positioned box with left set and width auto shrinks to the space beside it, so
     its width would depend on where it is placed. */
  width: max-content;
  max-width: 280px;

  padding-block: 8px;
  display: inline-block;
  border-radius: 8px;
  pointer-events: auto;
`

const WidgetTitleArea = styled(m.div)<{ $hasPip?: boolean }>`
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

const InitialWash = styled(m.div)`
  position: absolute;
  inset: 0;

  background-color: var(--theme-primary);
  pointer-events: none;
  z-index: 1;
`

const WidgetTitle = styled.div`
  ${titleMedium};
  ${singleLine};
`

const WidgetChildren = styled(m.div)`
  padding-inline: 8px;

  display: flex;
  flex-direction: column;

  gap: 12px;
`

const DragHandle = styledWithAttrs(MaterialIcon, { icon: 'drag_indicator' })``

const TitleActionButton = styled(IconButton)`
  flex-shrink: 0;
  margin-left: auto;
  width: 24px;
  min-height: 24px;
`

interface WidgetProps {
  title: string
  hasTitlePip?: boolean
  /** An optional icon button rendered at the end of the title bar (e.g. to reopen a dialog). */
  titleAction?: React.ReactNode
  onDragStart: (e: React.MouseEvent, widget: HTMLElement) => void
  children: React.ReactNode
}

function Widget({
  title,
  hasTitlePip = false,
  titleAction,
  onDragStart,
  children,
  ...rest
}: WidgetProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [sizeRef, contentRect] = useObservedDimensions<HTMLDivElement>()
  const composedRef = useMultiplexRef(rootRef, sizeRef)

  const width = contentRect?.width ?? 0
  const height = contentRect?.height ?? 0

  return (
    <WidgetRoot
      {...rest}
      ref={composedRef}
      style={
        {
          '--_width': `${width}px`,
          '--_height': `${height}px`,
        } as React.CSSProperties
      }
      layout='size'
      initial='initial'
      animate='animate'
      exit='exit'
      variants={{
        initial: { clipPath: 'circle(0% at center center)', opacity: 1, pointerEvents: 'none' },
        animate: {
          clipPath: 'circle(100% at center center)',
          opacity: 1,
          pointerEvents: 'auto',
          transition: {
            type: 'spring',
            duration: 0.6,
            bounce: 0,
          },
        },
        exit: {
          clipPath: 'circle(100% at center center)',
          opacity: 0,
          pointerEvents: 'none',
          transition: { type: 'spring', duration: 0.3, bounce: 0 },
        },
      }}>
      <WidgetTitleArea
        layout='size'
        onMouseDown={e => {
          if (rootRef.current) onDragStart(e, rootRef.current)
        }}
        style={{ cursor: 'move' }}
        $hasPip={hasTitlePip}>
        <DragHandle />
        <WidgetTitle>{title}</WidgetTitle>
        {titleAction}
      </WidgetTitleArea>
      <WidgetChildren layout='size'>{children}</WidgetChildren>
      <InitialWash
        variants={{ initial: { opacity: 1 }, animate: { opacity: 0 } }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
      />
    </WidgetRoot>
  )
}

type WidgetContainerProps = Except<WidgetProps, 'children' | 'title'>

const LobbyInfo = styled.div`
  display: grid;
  grid-template-columns: auto minmax(auto, 1fr);

  align-items: baseline;
  column-gap: 8px;
  row-gap: 4px;
`

const CountdownText = styled.span<{ $low: boolean }>`
  ${titleLarge};

  margin-top: 4px;

  display: block;
  font-feature-settings: 'tnum' on;
  text-align: center;
  color: ${props => (props.$low ? 'var(--theme-error)' : 'inherit')};
`

const LobbyCountdown = styled.div`
  display: flex;
  flex-direction: column;
`

const LobbyStatusText = styled(BodyMedium)`
  text-align: center;
  color: var(--theme-on-surface-variant);
`

export function LobbyWidget(props: WidgetContainerProps) {
  const { t } = useTranslation()
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const lobbyId = useAppSelector(s => s.lobby.info.id)
  const hasUnread = useAppSelector(s => s.lobby.hasUnread)
  const lobbyInfo = useAppSelector(s => s.lobby.info)
  const { isCountingDown, countdownTimer, isLoading } = useAppSelector(s => s.lobby.loadingState)
  // System lines (joins, countdown ticks, etc.) are left out: the preview is for what people said.
  const latestMessage = useAppSelector(s =>
    s.lobby.chat.findLast(
      (message): message is CommonTextMessage =>
        message.type === CommonMessageType.TextMessage && !s.relationships.blocks.has(message.from),
    ),
  )
  const totalSlots = slotCount(lobbyInfo)
  const takenSlots = takenSlotCount(lobbyInfo)

  let statusContent: React.ReactNode
  if (isLoading) {
    statusContent = (
      <LobbyStatusText>
        {t('gameplayActivity.lobby.gameStarting', 'Game starting…')}
      </LobbyStatusText>
    )
  } else if (isCountingDown) {
    statusContent = (
      <LobbyCountdown>
        <LobbyStatusText>
          {t('gameplayActivity.lobby.startingIn', 'Game starts in')}
        </LobbyStatusText>
        <CountdownText $low={false}>{Math.max(countdownTimer, 0)}</CountdownText>
      </LobbyCountdown>
    )
  } else {
    statusContent = (
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
    )
  }

  return (
    <Widget {...props} title={lobbyName} hasTitlePip={hasUnread}>
      {statusContent}
      {latestMessage ? <MessagePreviewLine message={latestMessage} /> : null}
      <OutlinedButton
        iconStart='arrow_forward'
        label={t('gameplayActivity.lobby.viewLobby', 'View lobby')}
        onClick={() => push(urlForLobby(lobbyId, lobbyName))}
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

/**
 * How often the widget's accept countdown re-renders. Unlike the accept-match dialog's animated
 * countdown, the widget only displays whole seconds, so a coarser tick is enough to keep it
 * accurate.
 */
const WIDGET_COUNTDOWN_TICK_MS = 1000

const AcceptProgressText = styled(BodyMedium)`
  text-align: center;
  color: var(--theme-on-surface-variant);
`

const DevButtonRow = styled.div`
  display: flex;
  justify-content: center;
  gap: 4px;
`

/** Development tools for exercising the accept flow without a second client. */
function SimulateMatchPopButtons() {
  const dispatch = useAppDispatch()
  const simulate = (opponentLeavesAfterMs?: number) => {
    dispatch(
      simulateMatchPop({ opponentLeavesAfterMs }, { onSuccess: () => {}, onError: () => {} }),
    )
  }

  return (
    <DevButtonRow>
      <TextButton label='Pop' onClick={() => simulate()} />
      <TextButton label='Pop (leaver)' onClick={() => simulate(10_000)} />
    </DevButtonRow>
  )
}

export function MatchmakingWidget(props: WidgetContainerProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const foundMatch = useAtomValue(foundMatchAtom)
  const isMatched = !!foundMatch
  const hasAccepted = useAtomValue(hasAcceptedAtom)
  const startTime = useAtomValue(currentSearchInfoAtom)?.startTime

  const [isCancelling, setIsCancelling] = useState(false)
  const { acceptInProgress, triggerAccept } = useAcceptMatch()

  const { secondsLeft, lowTime } = useAcceptCountdown(foundMatch, WIDGET_COUNTDOWN_TICK_MS)

  let bodyContent: React.ReactNode
  if (foundMatch) {
    let readyAction: React.ReactNode
    if (!hasAccepted) {
      readyAction = (
        <FilledButton
          label={t('matchmaking.acceptMatch.readyUp', 'Ready up')}
          disabled={acceptInProgress}
          onClick={() => triggerAccept()}
        />
      )
    } else {
      readyAction = (
        <BodyMedium>
          {t('gameplayActivity.matchmaking.waitingForPlayers', 'Waiting for other players…')}
        </BodyMedium>
      )
    }

    bodyContent = (
      <>
        <CountdownText $low={lowTime}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
        </CountdownText>
        <AcceptProgressText>
          {t('gameplayActivity.matchmaking.acceptedCount', {
            defaultValue: '{{accepted}} / {{total}} ready',
            accepted: foundMatch.acceptedPlayers,
            total: foundMatch.numPlayers,
          })}
        </AcceptProgressText>
        {readyAction}
      </>
    )
  } else if (startTime === undefined) {
    bodyContent = <BodyLarge>…</BodyLarge>
  } else {
    bodyContent = <StyledElapsedTime startTimeMs={startTime} />
  }

  const reopenDialogLabel = t(
    'gameplayActivity.matchmaking.reopenAcceptDialog',
    'Reopen match dialog',
  )

  return (
    <Widget
      {...props}
      title={
        isMatched
          ? t('gameplayActivity.matchmaking.matchFound', 'Match found!')
          : t('gameplayActivity.matchmaking.searching', 'Searching for a match…')
      }
      titleAction={
        isMatched ? (
          <TitleActionButton
            icon={<MaterialIcon icon='open_in_new' size={16} />}
            onMouseDown={event => event.stopPropagation()}
            onClick={() => dispatch(openAcceptMatchDialog())}
            title={reopenDialogLabel}
            ariaLabel={reopenDialogLabel}
          />
        ) : undefined
      }>
      {bodyContent}
      {!isMatched ? (
        <OutlinedButton
          iconStart='close'
          label={t('common.actions.cancel', 'Cancel')}
          disabled={isCancelling}
          onClick={() => {
            setIsCancelling(true)
            dispatch(
              cancelFindMatch({
                onSuccess: () => setIsCancelling(false),
                onError: () => setIsCancelling(false),
              }),
            )
          }}
        />
      ) : null}
      {import.meta.env.DEV && !isMatched ? <SimulateMatchPopButtons /> : null}
    </Widget>
  )
}
