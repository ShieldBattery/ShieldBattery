import keycode from 'keycode'
import { rgba } from 'polished'
import React, { useCallback, useMemo, useRef } from 'react'
import styled from 'styled-components'
import { amberA400, colorDividers, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { buttonText, singleLine } from '../styles/typography'
import { HotkeyProp, useButtonHotkey, useButtonState } from './button'
import { buttonReset } from './button-reset'
import { Ripple } from './ripple'

const KEY_NUMBERS = [
  keycode('1'),
  keycode('2'),
  keycode('3'),
  keycode('4'),
  keycode('5'),
  keycode('6'),
  keycode('7'),
  keycode('8'),
  keycode('9'),
]

const Container = styled.div`
  position: relative;
  height: 40px;

  display: flex;
  flex-direction: row;
  align-items: center;
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
  height: 40px;

  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;

  padding: 0 16px;

  background-color: ${props => (props.$isActiveTab ? 'rgba(255, 255, 255, 0.08)' : 'transparent')};
  border: 1px solid ${props => (props.$isActiveTab ? rgba(amberA400, 0.24) : colorDividers)};
  border-radius: 4px;
  color: ${props => (props.$isActiveTab ? amberA400 : colorTextSecondary)};
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
  /** An array of hotkeys to register for this tab item. */
  hotkeys?: HotkeyProp[]
  /**
   * Called whenever this tab is selected. This will be set by the containing Tabs component and
   * should not be passed directly.
   */
  onSelected?: (value: T) => void
}

export const TabItem = React.memo(
  React.forwardRef(
    <T,>(
      { text, value, active, disabled, hotkeys, onSelected, className }: TabItemProps<T>,
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

      // TODO(2Pac): Move this to a common hook that multiplexes refs and share with activity button
      const tabItemRef = useRef<HTMLButtonElement>()
      const setTabItemRef = useCallback(
        (elem: HTMLButtonElement | null) => {
          tabItemRef.current = elem ?? undefined
          if (ref) {
            if (typeof ref === 'function') {
              ref(elem)
            } else {
              ref.current = elem
            }
          }
        },
        [ref],
      )
      useButtonHotkey({ ref: tabItemRef, disabled, hotkey: hotkeys! })

      return (
        <TabItemContainer
          ref={setTabItemRef}
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
  className?: string
}

export function Tabs<T>({ children, activeTab, onChange, className }: TabsProps<T>) {
  const tabElems = useMemo(() => {
    const tabs = React.Children.map(children, (child, i) => {
      if (!child) {
        // Skip nulls to allow for optional tabs
        return child
      }

      const childHotkeys = (child.props as TabItemProps<T>).hotkeys
      const hotkeys: HotkeyProp[] = []

      if (Array.isArray(childHotkeys)) {
        for (const childHotkey of childHotkeys) {
          hotkeys.push(childHotkey)
        }
      }

      hotkeys.push({ keyCode: KEY_NUMBERS[i], ctrlKey: true })
      if (children.length - 1 === i) {
        // The last tab item has an additional Ctrl+9 hotkey
        hotkeys.push({ keyCode: KEY_NUMBERS[8], ctrlKey: true })
      }

      const isActive = activeTab === (child.props as TabItemProps<T>).value
      return React.cloneElement(child!, {
        key: `tab-${i}`,
        active: isActive,
        hotkeys,
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

  return <Container className={className}>{tabElems}</Container>
}
