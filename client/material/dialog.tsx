import keycode from 'keycode'
import { Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { titleLarge } from '../styles/typography'
import { IconButton } from './button'
import { useScrollIndicatorState } from './scroll-indicator'
import { elevationPlus3 } from './shadows'
import { zIndexDialog } from './zindex'

const ESCAPE = keycode('esc')

export interface DialogContextValue {
  isTopDialog: boolean
}
export const DialogContext = React.createContext<DialogContextValue>({
  isTopDialog: true,
})

const Container = styled.div`
  position: absolute;
  left: var(--pixel-shove-x, 0);
  right: 0;
  top: var(--pixel-shove-y, 0);
  bottom: 0;

  display: flex;
  align-items: center;
  justify-content: space-around;
  pointer-events: none;
  z-index: ${zIndexDialog};

  & > * {
    --pixel-shove-x: 0;
    --pixel-shove-y: 0;
  }
`

const Surface = styled(m.div)<{ $isTopDialog?: boolean }>`
  ${elevationPlus3};
  ${containerStyles(ContainerLevel.Normal)};

  width: calc(100% - 160px);
  max-width: 768px;
  max-height: calc(100% - 160px);
  flex-grow: 0;
  flex-shrink: 0;
  position: relative;

  display: flex;
  flex-direction: column;

  border-radius: 4px;
  contain: paint;
  overscroll-behavior: contain;
  pointer-events: ${props => (props.$isTopDialog ? 'auto' : 'none')};
`

const TitleBar = styled.div<{ $fullBleed?: boolean; $showDivider?: boolean }>`
  position: relative;

  ${props =>
    props.$fullBleed
      ? css`
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;

          background-color: rgb(from var(--color-blue10) r g b / 0.5);
          opacity: 0;
          transition: opacity 75ms linear;
          z-index: 1;

          ${Surface}:hover & {
            opacity: 1;
          }
        `
      : ''};

  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  align-items: center;

  &::after {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 1px;

    background-color: ${props =>
      props.$showDivider ? 'var(--theme-outline-variant)' : 'transparent'};
    content: '';
    transition: background-color 125ms linear;
  }
`

const Title = styled.div`
  ${titleLarge};
  flex-grow: 1;
  padding: 24px 24px 20px;
`

const CloseButton = styled(IconButton)`
  flex-shrink: 0;
  margin-right: 12px;
`

export const Body = styled.div<{ $fullBleed?: boolean }>`
  width: 100%;
  min-height: 64px;
  flex-grow: 1;

  contain: content;
  padding: ${props => (props.$fullBleed ? '0' : '0 24px 24px')};
  overflow: ${props => (props.$fullBleed ? 'hidden' : 'auto')};
`

const Actions = styled.div<{ $showDivider?: boolean }>`
  position: relative;
  flex-grow: 0;
  flex-shrink: 0;
  padding: 8px 4px 4px;

  display: flex;
  align-items: center;
  justify-content: flex-end;

  &::after {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 1px;

    background-color: ${props =>
      props.$showDivider ? 'var(--theme-outline-variant)' : 'transparent'};
    content: '';
    transition: background-color 125ms linear;
  }
`

const TabsContainer = styled.div<{ $showDivider?: boolean }>`
  position: relative;
  padding: 0 24px 8px;

  &::after {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 1px;

    background-color: ${props =>
      props.$showDivider ? 'var(--theme-outline-variant)' : 'transparent'};
    content: '';
    transition: background-color 125ms linear;
  }
`

const dialogVariants: Variants = {
  initial: { opacity: 0, y: '-100%', scaleX: 0.6, scaleY: 0.2 },
  animate: { opacity: 1, y: '0%', scaleX: 1, scaleY: 1 },
  exit: { opacity: 0, y: '-120%', scaleX: 0.4, scaleY: 0.15 },
}

const dialogTransition: Transition = {
  default: { type: 'spring', duration: 0.6 },
  opacity: { type: 'spring', duration: 0.35, bounce: 0 },
  scaleX: { type: 'spring', duration: 0.45, bounce: 0 },
  scaleY: { type: 'spring', duration: 0.45, bounce: 0 },
}

export interface DialogProps {
  buttons?: React.ReactNode[]
  children: React.ReactNode
  className?: string
  /**
   * Whether the content of this dialog extends to all edges (e.g. has no padding). If `true`, the
   * content must handle scrolling itself.
   */
  fullBleed?: boolean
  showCloseButton?: boolean
  style?: React.CSSProperties
  tabs?: React.ReactNode
  title: string
  titleAction?: React.ReactNode
  onCancel?: () => void
  alwaysHasTopDivider?: boolean
  testName?: string
}

export function Dialog({
  buttons,
  children,
  className,
  fullBleed = false,
  showCloseButton = false,
  style,
  tabs,
  title,
  titleAction,
  onCancel,
  alwaysHasTopDivider = false,
  testName,
}: DialogProps) {
  const { t } = useTranslation()
  const dialogContext = useContext(DialogContext)

  useKeyListener({
    onKeyDown: useCallback(
      (event: KeyboardEvent) => {
        if (onCancel && event.keyCode === ESCAPE) {
          onCancel()
          return true
        }

        return false
      },
      [onCancel],
    ),
  })
  const [isAtTop, isAtBottom, topNode, bottomNode] = useScrollIndicatorState()

  const closeButton = showCloseButton ? (
    <CloseButton
      icon={<MaterialIcon icon='close' />}
      title={t('material.dialog.closeDialog', 'Close dialog')}
      onClick={onCancel}
    />
  ) : null

  return (
    <Container role='dialog' data-test={testName}>
      <Surface
        className={className}
        style={style}
        variants={dialogVariants}
        initial='initial'
        animate='animate'
        exit='exit'
        transition={dialogTransition}
        $isTopDialog={dialogContext.isTopDialog}>
        <TitleBar $fullBleed={fullBleed} $showDivider={!isAtTop && !tabs}>
          <Title>{title}</Title>
          {titleAction}
          {closeButton}
        </TitleBar>
        {tabs ? (
          <TabsContainer $showDivider={!isAtTop || alwaysHasTopDivider}>{tabs}</TabsContainer>
        ) : null}

        <Body $fullBleed={fullBleed}>
          {topNode}
          {children}
          {bottomNode}
        </Body>
        {buttons && buttons.length ? (
          <Actions $showDivider={!isAtBottom} data-test='dialog-actions'>
            {buttons}
          </Actions>
        ) : null}
      </Surface>
    </Container>
  )
}
