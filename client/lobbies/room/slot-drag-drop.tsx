import { LayoutGroup, MotionValue, useMotionValue, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType } from '../../../common/games/game-type'
import { Team } from '../../../common/lobbies'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { labelSmall } from '../../styles/typography'
import { canMoveSlot } from './slot-movement'

const SlotRoot = styled(m.div)<{ $draggable: boolean }>`
  position: relative;
  border-radius: 8px;
  cursor: ${props => (props.$draggable ? 'grab' : 'inherit')};
  touch-action: pan-y;

  [data-slot-drag-handle] {
    touch-action: ${props => (props.$draggable ? 'none' : 'auto')};
  }
  user-select: ${props => (props.$draggable ? 'none' : 'auto')};

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: 2px;
  }
`

const DropHighlight = styled(m.div)`
  position: absolute;
  inset: 0;
  border: 2px solid var(--theme-primary);
  border-radius: inherit;
  background-color: rgb(from var(--theme-primary) r g b / 0.12);
  pointer-events: none;
  z-index: 1;
`

const DropLabel = styled.span`
  ${labelSmall};
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  background-color: var(--theme-container-high);
  color: var(--theme-primary);
`

const DragPreview = styled(m.div)`
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1000;
  border-radius: 8px;
  outline: 1px solid var(--theme-primary);
  background-color: var(--theme-container-low);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
  pointer-events: none;
`

const LiveMessage = styled.div`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
`

interface SlotEntry {
  team: Team
  slot: Slot
}

interface DragState {
  sourceId: string
  targetId?: string
  revision: string
  kind: 'pointer' | 'keyboard'
  width: number
}

interface PointerGesture {
  sourceId: string
  pointerId: number
  originX: number
  originY: number
  x: number
  y: number
  bounds: DOMRect
  capture: HTMLElement
  revision: string
  started: boolean
}

type SlotInteractionProps = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerCancel'
  | 'onLostPointerCapture'
  | 'onDragStartCapture'
  | 'onClickCapture'
  | 'onKeyDown'
  | 'onKeyDownCapture'
  | 'onBlur'
>

interface DragContextValue {
  drag: DragState | undefined
  hintId: string
  x: MotionValue<number>
  y: MotionValue<number>
  canDrag: (slotId: string) => boolean
  canDrop: (slotId: string) => boolean
  register: (slotId: string, node: HTMLDivElement | null) => void
  rowProps: (slotId: string) => SlotInteractionProps
}

const DragContext = createContext<DragContextValue | undefined>(undefined)

/** Host-directed moves use the server's slot rules, including occupied destinations for swaps. */
export function SlotDragProvider({
  teams,
  gameType,
  enabled,
  onMoveSlot,
  children,
}: {
  teams: ReadonlyArray<Team>
  gameType: GameType
  enabled: boolean
  onMoveSlot: (fromSlotId: string, toSlotId: string) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const hintId = useId()
  const entries: SlotEntry[] = teams.flatMap(team => team.slots.map(slot => ({ team, slot })))
  // Occupant or seating changes invalidate an in-flight gesture; race and readiness changes do not.
  const revision = JSON.stringify([
    enabled,
    gameType,
    teams.map(team => [
      team.isObserver,
      team.slots.map(s => [s.id, s.type, s.userId, s.controlledBy]),
    ]),
  ])
  const [dragState, setDrag] = useState<DragState>()
  const [lastRevision, setLastRevision] = useState(revision)
  if (lastRevision !== revision) {
    setLastRevision(revision)
    setDrag(undefined)
  }
  const drag = enabled && dragState?.revision === revision ? dragState : undefined
  const pointer = useRef<PointerGesture | undefined>(undefined)
  const elements = useRef(new Map<string, HTMLDivElement>())
  const suppressClick = useRef(false)
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  function destinations(sourceId: string) {
    const from = entries.find(e => e.slot.id === sourceId)
    return enabled && from
      ? entries.filter(to => canMoveSlot(gameType, from.team, from.slot, to.team, to.slot))
      : []
  }

  function hitTarget(gesture: PointerGesture) {
    if (!enabled || gesture.revision !== revision) return undefined
    const element = document.elementFromPoint(gesture.x, gesture.y)?.closest('[data-drag-slot]')
    const id = element?.getAttribute('data-drag-slot')
    return id &&
      elements.current.get(id) === element &&
      destinations(gesture.sourceId).some(e => e.slot.id === id)
      ? id
      : undefined
  }

  function releasePointer() {
    const gesture = pointer.current
    pointer.current = undefined
    if (gesture?.capture.hasPointerCapture(gesture.pointerId)) {
      gesture.capture.releasePointerCapture(gesture.pointerId)
    }
  }

  function cancel() {
    releasePointer()
    setDrag(undefined)
  }

  const releaseStalePointer = useEffectEvent(() => {
    if (pointer.current?.revision !== revision) releasePointer()
  })
  useLayoutEffect(() => releaseStalePointer(), [revision])
  useLayoutEffect(() => () => releasePointer(), [])

  const cancelOnInterruption = useEffectEvent(() => cancel())
  useEffect(() => {
    const onBlur = () => cancelOnInterruption()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelOnInterruption()
    }
    const onVisibility = () => {
      if (document.hidden) cancelOnInterruption()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const scrollWhileDragging = useEffectEvent(() => {
    const gesture = pointer.current
    if (!gesture?.started || gesture.revision !== revision) return
    const scroll = elements.current.get(gesture.sourceId)?.closest('[data-slot-scroll]')
    if (!scroll) return
    const bounds = scroll.getBoundingClientRect()
    if (gesture.x < bounds.left || gesture.x > bounds.right) return
    let distance = 0
    if (gesture.y < bounds.top + 32) {
      distance = -Math.min(12, (bounds.top + 32 - gesture.y) / 3)
    } else if (gesture.y > bounds.bottom - 32) {
      distance = Math.min(12, (gesture.y - bounds.bottom + 32) / 3)
    }
    if (distance) {
      scroll.scrollTop += distance
      const targetId = hitTarget(gesture)
      setDrag(current =>
        current?.targetId === targetId ? current : current && { ...current, targetId },
      )
    }
  })
  useEffect(() => {
    if (drag?.kind !== 'pointer') return undefined
    let frame: number
    const tick = () => {
      scrollWhileDragging()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [drag?.kind])

  function rowProps(slotId: string): SlotInteractionProps {
    return {
      onPointerDown: event => {
        if (event.button !== 0 || !event.isPrimary || pointer.current) return
        suppressClick.current = false
        if (drag?.kind === 'keyboard') setDrag(undefined)
        const target = event.target as Element
        if (
          !destinations(slotId).length ||
          target.closest('[data-slot-controls], button, a, input, select, textarea') ||
          (event.pointerType === 'touch' && !target.closest('[data-slot-drag-handle]'))
        )
          return
        const bounds = event.currentTarget.getBoundingClientRect()
        const capture = event.target instanceof HTMLElement ? event.target : event.currentTarget
        pointer.current = {
          sourceId: slotId,
          pointerId: event.pointerId,
          originX: event.clientX,
          originY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          bounds,
          capture,
          revision,
          started: false,
        }
        capture.setPointerCapture(event.pointerId)
      },
      onPointerMove: event => {
        const gesture = pointer.current
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.revision !== revision)
          return
        gesture.x = event.clientX
        gesture.y = event.clientY
        if (
          !gesture.started &&
          Math.hypot(gesture.x - gesture.originX, gesture.y - gesture.originY) < 6
        )
          return
        event.preventDefault()
        if (!gesture.started) {
          gesture.started = true
          suppressClick.current = true
          event.currentTarget.focus({ preventScroll: true })
        }
        x.set(gesture.bounds.left + gesture.x - gesture.originX)
        y.set(gesture.y - gesture.bounds.height - 12)
        const targetId = hitTarget(gesture)
        setDrag(current =>
          current?.sourceId === slotId && current.targetId === targetId
            ? current
            : {
                sourceId: slotId,
                targetId,
                revision,
                kind: 'pointer',
                width: gesture.bounds.width,
              },
        )
      },
      onPointerUp: event => {
        const gesture = pointer.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gesture.x = event.clientX
        gesture.y = event.clientY
        const targetId = gesture.started ? hitTarget(gesture) : undefined
        // Native pointer-up releases capture after dispatching the gesture's click.
        pointer.current = undefined
        setDrag(undefined)
        if (targetId) onMoveSlot(gesture.sourceId, targetId)
      },
      onPointerCancel: () => cancel(),
      onLostPointerCapture: () => {
        if (pointer.current) cancel()
      },
      onDragStartCapture: event => event.preventDefault(),
      onClickCapture: event => {
        if (suppressClick.current) {
          event.preventDefault()
          event.stopPropagation()
          suppressClick.current = false
        }
      },
      onKeyDownCapture: event => {
        if (!pointer.current && !drag && (event.key === ' ' || event.key === 'Enter')) {
          suppressClick.current = false
        }
      },
      onKeyDown: event => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
          return
        }
        const targets = destinations(slotId)
        if (!targets.length || pointer.current) return
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          if (event.repeat) return
          if (drag?.kind === 'keyboard' && drag.sourceId === slotId) {
            const targetId = drag.targetId
            cancel()
            if (targetId && targets.some(e => e.slot.id === targetId)) onMoveSlot(slotId, targetId)
          } else {
            setDrag({ sourceId: slotId, revision, kind: 'keyboard', width: 0 })
          }
        } else if (
          drag?.kind === 'keyboard' &&
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
        ) {
          event.preventDefault()
          const current = targets.findIndex(e => e.slot.id === drag.targetId)
          const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          let next = (current + (backwards ? -1 : 1) + targets.length) % targets.length
          if (current < 0) next = backwards ? targets.length - 1 : 0
          const targetId = targets[next].slot.id
          setDrag({ ...drag, targetId })
          elements.current.get(targetId)?.scrollIntoView({ block: 'nearest' })
        }
      },
      onBlur: event => {
        if (drag?.kind === 'keyboard' && !event.currentTarget.contains(event.relatedTarget as Node))
          cancel()
      },
    }
  }

  const targetNumber = drag?.targetId ? entries.findIndex(e => e.slot.id === drag.targetId) + 1 : 0
  let announcement = ''
  if (drag?.kind === 'keyboard') {
    announcement = targetNumber
      ? t(
          'lobbies.room.drag.selectedTarget',
          'Slot {{number}} selected. Press Space to move or swap.',
          { number: targetNumber },
        )
      : t(
          'lobbies.room.drag.chooseTarget',
          'Choose a destination with the arrow keys. Space drops, Escape cancels.',
        )
  }
  return (
    <DragContext.Provider
      value={{
        drag,
        hintId,
        x,
        y,
        canDrag: slotId => destinations(slotId).length > 0,
        canDrop: slotId => !!drag && destinations(drag.sourceId).some(e => e.slot.id === slotId),
        register: (slotId, node) => {
          if (node) elements.current.set(slotId, node)
          else elements.current.delete(slotId)
        },
        rowProps,
      }}>
      <LayoutGroup id={hintId}>
        {enabled ? (
          <LiveMessage id={hintId}>
            {t(
              'lobbies.room.drag.keyboardInstructions',
              'Press Space to pick up this player, use arrow keys to choose a slot, then Space to drop. Escape cancels.',
            )}
          </LiveMessage>
        ) : null}
        <LiveMessage role='status' aria-live='polite'>
          {announcement}
        </LiveMessage>
        {children}
      </LayoutGroup>
    </DragContext.Provider>
  )
}

export function DraggableSlot({ slot, children }: { slot: Slot; children: ReactNode }) {
  const context = useContext(DragContext)!
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const draggable = context.canDrag(slot.id)
  const source = context.drag?.sourceId === slot.id
  const target = context.drag?.targetId === slot.id
  const available = context.canDrop(slot.id)
  const occupied =
    slot.type === SlotType.Human ||
    slot.type === SlotType.Observer ||
    slot.type === SlotType.Computer
  return (
    <SlotRoot
      ref={node => context.register(slot.id, node)}
      {...context.rowProps(slot.id)}
      data-drag-slot={slot.id}
      data-drop-target={target ? 'true' : undefined}
      $draggable={draggable}
      tabIndex={draggable ? 0 : undefined}
      aria-describedby={draggable ? context.hintId : undefined}
      layout='position'
      layoutId={slot.id}
      animate={{ opacity: source && context.drag?.kind === 'pointer' ? 0.35 : 1 }}
      transition={{ type: 'tween', duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }}>
      {children}
      <DropHighlight
        aria-hidden={true}
        initial={false}
        animate={{ opacity: target ? 1 : Number(available) * 0.3 }}
        transition={{ duration: reducedMotion ? 0 : 0.12 }}>
        {target ? (
          <DropLabel>
            {occupied
              ? t('lobbies.room.drag.swap', 'Swap places')
              : t('lobbies.room.drag.move', 'Move here')}
          </DropLabel>
        ) : null}
      </DropHighlight>
      {source && context.drag?.kind === 'pointer'
        ? createPortal(
            <DragPreview
              aria-hidden={true}
              inert
              style={{ x: context.x, y: context.y, width: context.drag.width }}
              initial={{ scale: 1 }}
              animate={{ scale: reducedMotion ? 1 : 1.025 }}
              transition={{ type: 'tween', duration: 0.12 }}>
              {children}
            </DragPreview>,
            document.body,
          )
        : null}
    </SlotRoot>
  )
}
