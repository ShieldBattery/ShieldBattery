import React, { useRef } from 'react'
import styled from 'styled-components'
import { Tagged } from 'type-fest'
import { Link, LinkProps, useRoute } from 'wouter'
import { useHistoryState } from 'wouter/use-browser-location'
import { FocusTrap } from '../dom/focus-trap'
import { useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { zIndexMenu, zIndexMenuBackdrop } from '../material/zindex'
import { useStableCallback } from '../react/state-hooks'
import { labelLarge, singleLine } from '../styles/typography'
import { pushCurrentWithState } from './routing'

const Scrim = styled.div`
  position: fixed;
  inset: 0;
  background-color: var(--theme-dialog-scrim);
  opacity: var(--theme-dialog-scrim-opacity);
  z-index: ${zIndexMenuBackdrop};
`

const Root = styled.div`
  ${elevationPlus1};
  position: fixed;
  inset: var(--sb-system-bar-height, 0) 0 0;
  max-width: min(360px, 100dvw - 64px);
  z-index: ${zIndexMenu};

  background-color: var(--theme-container-low);
  border-radius: 0 12px 12px 0;
  contain: content;
  overflow: hidden;
`

// NOTE(tec27): This exists to allow the scrollbar to be clipped by the rounded corners
const ScrollableContent = styled.div`
  width: 100%;
  height: 100%;
  padding-block: 24px;

  overflow: auto;
`

export type NavigationOpenState = Tagged<boolean, 'NavigationOpenState'>
export type NavigationOnClose = Tagged<() => void, 'NavigationOnClose'>

/**
 * Returns the current navigation menu state and callbacks to open/close it. `menuName` should be
 * unique to any other navigation menu on the screen with this one.
 */
export function useNavigationMenuState(
  menuName: string,
): [open: NavigationOpenState, onOpen: () => void, onClose: NavigationOnClose] {
  const stateId = `NAVIGATION_MENU:${menuName}`
  const open = useHistoryState() === stateId
  const onOpen = useStableCallback(() => {
    if (history.state !== stateId) {
      pushCurrentWithState(stateId)
    }
  })
  const onClose = useStableCallback(() => {
    // Just in case a navigation already happened somehow
    if (history.state === stateId) {
      history.back()
    }
  })

  return [open as NavigationOpenState, onOpen, onClose as NavigationOnClose]
}

export interface NavigationMenuOverlayProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  focusableRef?: React.RefObject<HTMLElement | null>
}

export function NavigationMenuOverlay({
  open,
  onClose,
  children,
  className,
  focusableRef,
}: NavigationMenuOverlayProps) {
  const internalFocusableRef = useRef<HTMLSpanElement>(null)

  // TODO(tec27): Add transition animations
  return open ? (
    <>
      <Scrim
        onClick={e => {
          if (e.target === e.currentTarget) {
            onClose()
          }
        }}
      />
      <FocusTrap focusableRef={focusableRef ?? internalFocusableRef}>
        <Root className={className}>
          <ScrollableContent>
            {focusableRef ? null : <span ref={internalFocusableRef} tabIndex={-1} />}
            {children}
          </ScrollableContent>
        </Root>
      </FocusTrap>
    </>
  ) : (
    <></>
  )
}

const ItemRoot = styled.a<{ $isActive: boolean }>`
  position: relative;
  width: 100%;
  height: 56px;
  padding: 0 28px 0 36px;

  display: flex;
  align-items: center;
  gap: 12px;

  --_link-color: ${props =>
    props.$isActive ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)'};
  color: var(--_link-color);

  &:link,
  &:visited {
    color: var(--_link-color);
    text-decoration: none;
  }

  &:hover,
  &:active {
    color: var(--theme-amber);
    text-decoration: none;
  }
`

const ItemIcon = styled.div`
  width: 24px;
  height: 24px;
  flex-grow: 0;
  flex-shrink: 0;
`

const ItemText = styled.div`
  ${labelLarge};
  ${singleLine};
  flex-grow: 1;
  flex-shrink: 1;
`

const StateLayer = styled.div<{ $isActive: boolean }>`
  position: absolute;
  inset: 4px 12px;

  border-radius: 12px;
  contain: content;
  z-index: -1;

  --_bg-color: ${props => (props.$isActive ? 'var(--theme-grey-blue-container)' : 'transparent')};
  --sb-ripple-color: var(--theme-on-surface);

  &:before {
    position: absolute;
    inset: 0;

    background-color: var(--_bg-color);
    content: '';
  }
`

const ItemPip = styled.div`
  position: absolute;
  left: 22px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  background-color: var(--theme-amber);
  border-radius: 50%;
`

export interface NavigationMenuItemProps
  extends Omit<LinkProps, 'replace' | 'children' | 'href' | 'to' | 'asChild'> {
  href: string
  routePattern: string
  icon?: React.ReactNode
  text: string
  showPip?: boolean
  ref?: React.Ref<HTMLAnchorElement>
}

export function NavigationMenuItem({
  icon,
  text,
  href,
  routePattern,
  showPip,
  ref,
  ...linkProps
}: NavigationMenuItemProps) {
  const [isActive] = useRoute(routePattern)
  const [buttonProps, rippleRef] = useButtonState({})
  // NOTE(tec27): We set 'replace' because the navigation menu uses route state, so we want the back
  // button to go back to the page *without* the navigation menu open
  return (
    <Link {...linkProps} href={href} asChild={true} replace={true}>
      <ItemRoot ref={ref} $isActive={isActive} tabIndex={0} draggable={false} {...buttonProps}>
        <StateLayer $isActive={isActive}>
          <Ripple ref={rippleRef} />
        </StateLayer>
        {icon ? <ItemIcon>{icon}</ItemIcon> : null}
        <ItemText>{text}</ItemText>
        {showPip ? <ItemPip /> : null}
      </ItemRoot>
    </Link>
  )
}

export const NavigationMenuDivider = styled.hr`
  height: 1px;
  margin: 7px 28px 8px;

  background-color: var(--theme-outline);
  border: none;
`
