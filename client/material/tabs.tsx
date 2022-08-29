import keycode from 'keycode'
import { rgba } from 'polished'
import React, { useCallback, useMemo } from 'react'
import styled from 'styled-components'
import { useKeyListener } from '../keyboard/key-listener'
import { useMultiRef } from '../state-hooks'
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
const PAGEUP = keycode('page up')
const PAGEDOWN = keycode('page down')

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
  min-width: 8px;
  max-width: 24px;

  flex: 1 1 0;
`

export interface TabItemProps<T> {
  text: React.ReactNode
  value: T
  disabled?: boolean
  className?: string
  /**
   * Optional title to show for the tab. If not specified, `text` will be used at the title (so it
   * should be a `string` in that case).
   */
  title?: string
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
      {
        text,
        value,
        active,
        disabled,
        hotkeys,
        onSelected,
        className,
        title: tooltipText,
      }: TabItemProps<T>,
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

      const [tabItemRef, setTabItemRef] = useMultiRef<HTMLButtonElement>(ref)
      useButtonHotkey({ ref: tabItemRef, disabled, hotkey: hotkeys! })

      // TODO(tec27): Use `<Tooltip>` instead for this (and maybe only set the title from `text` if
      // it's overflowing?)
      const title = !tooltipText && typeof text === 'string' ? text : tooltipText

      return (
        <TabItemContainer
          ref={setTabItemRef}
          className={className}
          $isActiveTab={active ?? false}
          title={title}
          {...buttonProps}>
          {typeof text === 'string' ? <TabTitle>{text}</TabTitle> : text}
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
      const hotkeys = (childHotkeys ?? []).slice()

      hotkeys.push({ keyCode: KEY_NUMBERS[i], ctrlKey: true })
      if (children.length - 1 === i) {
        // The last tab item has an additional Ctrl+9 hotkey
        hotkeys.push({ keyCode: KEY_NUMBERS[8], ctrlKey: true })
      }

      const isActive = activeTab === (child.props as TabItemProps<T>).value
      return React.cloneElement(child, {
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

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if ((event.keyCode === PAGEUP || event.keyCode === PAGEDOWN) && event.ctrlKey === true) {
        if (!onChange) {
          return false
        }

        let activeTabIndex = 0
        const enabledChildren: React.ReactElement[] = []
        React.Children.forEach(children, child => {
          if (!child) {
            return
          }

          const childProps = child.props as TabItemProps<T>
          if (childProps.value === activeTab || !childProps.disabled) {
            enabledChildren.push(child)
          }
          if (childProps.value === activeTab) {
            // This needs to be the index in the `enabledChildren` array, not from all of the
            // children
            activeTabIndex = enabledChildren.length - 1
          }
        })

        if (enabledChildren.length < 2) {
          return true
        }

        if (event.keyCode === PAGEUP) {
          const previousIndex =
            (activeTabIndex - 1 + enabledChildren.length) % enabledChildren.length
          const tab = enabledChildren[previousIndex]
          onChange(tab.props.value)

          return true
        } else if (event.keyCode === PAGEDOWN) {
          const nextIndex = (activeTabIndex + 1) % enabledChildren.length
          const tab = enabledChildren[nextIndex]
          onChange(tab.props.value)

          return true
        }
      }

      return false
    },
  })

  return <Container className={className}>{tabElems}</Container>
}
