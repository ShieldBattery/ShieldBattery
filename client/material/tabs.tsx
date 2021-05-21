import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { useElementRect, useObservedDimensions } from '../dom/dimension-hooks'
import { useForceUpdate } from '../state-hooks'
import { amberA400, colorDividers, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { buttonText } from '../styles/typography'
import { useButtonState } from './button'
import { buttonReset } from './button-reset'
import { fastOutSlowIn } from './curve-constants'
import { Ripple } from './ripple'

const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: row;
  height: 48px;
  margin: 0;
  padding: 0;
  list-style: none;

  contain: content;
`

export const TabTitle = styled.span`
  ${buttonText};
`

export const TabItemContainer = styled.button<{ $isActiveTab: boolean }>`
  ${buttonReset};

  flex: 1 1 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: background-color 15ms linear;

  color: ${props => (props.$isActiveTab ? amberA400 : colorTextSecondary)};

  &:disabled {
    color: ${colorTextFaint};
  }
`

const ActiveIndicator = styled.div`
  position: absolute;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 2px;
  background-color: ${amberA400};
  transform: translateX(var(--sb-tab-indicator-x, 0)) scaleX(var(--sb-tab-indicator-width, 0));
  transform-origin: left;
  transition: transform 175ms ${fastOutSlowIn};
`

const BottomDivider = styled.div`
  position: absolute;
  height: 1px;
  bottom: 0;
  left: 0;
  right: 0;

  background-color: ${colorDividers};
`

export interface TabItemProps {
  text: string
  value: number
  active?: boolean
  disabled?: boolean
  onSelected?: (value: number) => void
  className?: string
}

export const TabItem = React.memo(
  React.forwardRef<HTMLButtonElement, TabItemProps>(
    ({ text, value, active, disabled, onSelected, className }, ref) => {
      const onClick = useCallback(() => {
        if (!disabled && onSelected) {
          onSelected(value)
        }
      }, [disabled, value, onSelected])
      const [buttonProps, rippleRef] = useButtonState({
        disabled,
        onClick,
      })

      return (
        <TabItemContainer
          ref={ref}
          className={className}
          $isActiveTab={active ?? false}
          {...buttonProps}>
          <TabTitle>{text}</TabTitle>
          <Ripple ref={rippleRef} disabled={disabled} />
        </TabItemContainer>
      )
    },
  ),
)

export interface TabsProps {
  children: ReturnType<typeof TabItem>[]
  activeTab: number
  onChange?: (value: number) => void
  bottomDivider?: boolean
  className?: string
}

export function Tabs({ children, activeTab, onChange, bottomDivider, className }: TabsProps) {
  const [indicatorWidth, setIndicatorWidth] = useState(0)
  const [indicatorX, setIndicatorX] = useState(0)
  const [dimensionsRef, dimensions] = useObservedDimensions()
  const [positionRef, position] = useElementRect()
  const containerRef = useRef<HTMLElement | undefined>()
  const selectedRef = useRef<HTMLButtonElement>(null)
  const forceUpdate = useForceUpdate()

  const combinedRefs = useCallback(
    (elem: HTMLElement | null) => {
      dimensionsRef(elem)
      positionRef(elem)
      containerRef.current = elem || undefined
    },
    [dimensionsRef, positionRef],
  )

  useLayoutEffect(() => {
    if (activeTab === undefined) {
      setIndicatorWidth(0)
      setIndicatorX(0)
      return
    }
    if (!selectedRef.current) {
      return
    }

    const selectedBounds = selectedRef.current.getBoundingClientRect()
    const x = selectedBounds.left - (position?.left ?? 0)

    setIndicatorWidth(selectedBounds.width)
    setIndicatorX(x)
  }, [activeTab, dimensions, position])

  // Adjust the indicator position if a transform animation completes. This is a sort-of hacky way
  // to handle the tabs inside dialogs properly, which otherwise leave the indicator in a bad spot.
  // The expectation is that if we force an update, `useElementRect` will return a different rect
  // at this point if our position changed.
  useLayoutEffect(() => {
    const listener = (event: TransitionEvent) => {
      if (
        event.propertyName === 'transform' &&
        event.target &&
        event.target !== containerRef.current &&
        !containerRef.current?.contains(event.target as Node) &&
        (event.target as HTMLElement).contains(containerRef.current!)
      ) {
        forceUpdate()
      }
    }

    document.addEventListener('transitionend', listener)
    // Do one forced update here to double-check the sizes, since even in LayoutEffect it seems to
    // miss transitions occasionally? :(
    forceUpdate()

    return () => {
      document.removeEventListener('transitionend', listener)
    }
  }, [forceUpdate])

  const tabs = useMemo(() => {
    return React.Children.map(children, (child, i) => {
      const isActive = i === activeTab
      return React.cloneElement(child!, {
        ref: isActive ? selectedRef : undefined,
        value: i,
        active: isActive,
        onSelected: onChange,
      })
    })
  }, [activeTab, children, onChange])

  const style = {
    '--sb-tab-indicator-x': `${indicatorX}px`,
    '--sb-tab-indicator-width': indicatorWidth,
  }

  return (
    <Container ref={combinedRefs} className={className} style={style as any}>
      {tabs}
      {bottomDivider ? <BottomDivider /> : null}
      <ActiveIndicator />
    </Container>
  )
}
