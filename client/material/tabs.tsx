import React, { useCallback, useMemo } from 'react'
import styled from 'styled-components'
import { amberA400, colorDividers, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { buttonText, singleLine } from '../styles/typography'
import { useButtonState } from './button'
import { buttonReset } from './button-reset'
import { Ripple } from './ripple'

const Container = styled.div`
  position: relative;
  height: 48px;
  margin: 0;
  /* 36px + 12px = 48px total height */
  padding: 6px 24px;

  display: flex;
  flex-direction: row;
  contain: content;
`

export const TabTitle = styled.span`
  ${buttonText};
  ${singleLine};
`

export const TabItemContainer = styled.button<{ $isActiveTab: boolean }>`
  ${buttonReset};

  flex: 1 1 auto;
  min-width: 64px;
  height: 36px;

  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;

  padding: 0 16px;

  color: ${props => (props.$isActiveTab ? amberA400 : colorTextSecondary)};
  background-color: ${props => (props.$isActiveTab ? 'rgba(255, 255, 255, 0.08)' : 'transparent')};
  border-radius: 4px;
  transition: background-color 15ms linear, color 15ms linear;

  &:disabled {
    color: ${colorTextFaint};
    background-color: transparent;
  }
`

export const TabSpacer = styled.div`
  height: 1px;
  min-width: 0px;
  max-width: 24px;

  flex: 1 1 0;
`

const BottomDivider = styled.div`
  position: absolute;
  height: 1px;
  bottom: 0;
  left: 0;
  right: 0;

  background-color: ${colorDividers};
`

export interface TabItemProps<T> {
  text: string
  value: T
  disabled?: boolean
  className?: string
  /**
   * Whether or not the tab is the active one. This will be set by the containing Tabs component and
   * should not be passed directly.
   */
  active?: boolean
  /**
   * Called whenever this tab is selected. This will be set by the containing Tabs component and
   * should not be passed directly.
   */
  onSelected?: (value: T) => void
}

export const TabItem = React.memo(
  React.forwardRef(
    <T,>(
      { text, value, active, disabled, onSelected, className }: TabItemProps<T>,
      ref: React.ForwardedRef<HTMLButtonElement>,
    ) => {
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
          title={text}
          {...buttonProps}>
          <TabTitle>{text}</TabTitle>
          <Ripple ref={rippleRef} disabled={disabled} />
        </TabItemContainer>
      )
    },
  ),
)

export interface TabsProps<T> {
  children: Array<ReturnType<typeof TabItem> | null>
  activeTab: T
  onChange?: (value: T) => void
  bottomDivider?: boolean
  className?: string
}

export function Tabs<T>({ children, activeTab, onChange, bottomDivider, className }: TabsProps<T>) {
  const tabElems = useMemo(() => {
    const tabs = React.Children.map(children, (child, i) => {
      if (!child) {
        // Skip nulls to allow for optional tabs
        return child
      }

      const isActive = activeTab === (child!.props as TabItemProps<T>).value
      return React.cloneElement(child!, {
        key: `tab-${i}`,
        active: isActive,
        onSelected: onChange,
      })
    })

    const tabElems: React.ReactNode[] = []
    for (let i = 0; i < tabs!.length; i++) {
      if (tabs![i]) {
        tabElems.push(tabs![i])
        tabElems.push(<TabSpacer key={`spacer-${i}`} />)
      }
    }
    // Remove the last spacer since we don't want spacers on the outside
    tabElems.pop()
    return tabElems
  }, [activeTab, children, onChange])

  return (
    <Container className={className}>
      {tabElems}
      {bottomDivider ? <BottomDivider /> : null}
    </Container>
  )
}
