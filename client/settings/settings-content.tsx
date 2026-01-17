import { Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Tooltip } from '../material/tooltip'
import { zIndexSettings } from '../material/zindex'
import { LoadingDotsArea } from '../progress/dots'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  headlineMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleSmall,
} from '../styles/typography'

export const FormContainer = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 32px;
`

export const SectionOverline = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

export const SectionContainer = styled.div`
  display: flex;
  flex-direction: column;
`

export const Container = styled(m.div)`
  position: absolute;
  top: var(--sb-system-bar-height, 0);
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0));

  display: flex;
  flex-direction: row;

  background-color: var(--theme-container-lowest);
  contain: content;
  z-index: ${zIndexSettings};
`

export const NavContainer = styled.div`
  width: 272px;
  padding: 16px 0;
  background-color: var(--color-grey-blue30);

  flex-shrink: 0;
`

export const NavSectionTitle = styled.div`
  ${labelMedium};
  ${singleLine};

  height: 36px;
  line-height: 36px;
  padding: 0 16px;

  color: var(--theme-on-surface-variant);
`

export const NavSectionSeparator = styled.div`
  height: 1px;
  margin: 7px 16px 8px;

  background-color: var(--theme-outline-variant);
`

export const variants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

export const transition: Transition = {
  type: 'spring',
  duration: 0.3,
  bounce: 0,
}

export const NavEntryRoot = styled.button<{ $isActive: boolean }>`
  ${buttonReset};
  position: relative;
  width: 100%;
  height: 36px;
  padding: 0 16px;

  display: flex;
  align-items: center;

  border-radius: 4px;
  contain: content;
  cursor: pointer;

  --sb-ripple-color: var(--theme-on-surface);
  background-color: ${props =>
    props.$isActive ? 'rgb(from var(--theme-on-surface) r g b / 0.08)' : 'transparent'};
  color: ${props => (props.$isActive ? 'var(--theme-amber)' : 'var(--theme-on-surface)')};

  transition: color 125ms linear;

  &[disabled] {
    cursor: not-allowed;
    color: rgba(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
  }

  :focus-visible {
    outline: none;
  }
`

export const NavEntryText = styled.span`
  ${titleSmall};
  ${singleLine};

  height: 100%;
  line-height: 36px;
`

export const NavEntryIcon = styled(MaterialIcon).attrs({ size: 20 })`
  margin-right: 4px;
`

export const ErrorIcon = styledWithAttrs(NavEntryIcon, { icon: 'error', filled: false })`
  color: var(--theme-error);
  margin-bottom: 2px;
`

export const ErrorText = styled(NavEntryText)`
  color: var(--theme-error);
`

const ContentContainer = styled.div`
  width: 100%;
  padding: 16px;
  overflow-y: auto;

  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 40px;
`

const Content = styled.div`
  flex-grow: 1;
  max-width: 704px;
`

const TitleBar = styled.div`
  position: relative;
  margin-bottom: 16px;

  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`

const Title = styled.span`
  ${headlineMedium};
`

const CloseButton = styled(IconButton)`
  &::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    border: 2px solid var(--theme-outline);
    border-radius: inherit;
  }
`

const LabeledCloseButton = styled.div`
  ${labelSmall};
  display: flex;
  flex-direction: column;
  gap: 4px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

export function SettingsContent({
  children,
  title,
  className,
  onCloseSettings,
}: {
  children: React.ReactNode
  title: string
  className?: string
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const closeLabel = t('settings.close', 'Close settings')

  return (
    <ContentContainer>
      <Content className={className}>
        <TitleBar>
          <Title>{title}</Title>
        </TitleBar>

        <React.Suspense fallback={<LoadingDotsArea />}>{children}</React.Suspense>
      </Content>

      <LabeledCloseButton>
        <Tooltip text={closeLabel} position='left' tabIndex={-1}>
          <CloseButton
            ariaLabel={closeLabel}
            icon={<MaterialIcon icon='close' />}
            onClick={onCloseSettings}
            testName='close-settings'
          />
        </Tooltip>
        <span>ESC</span>
      </LabeledCloseButton>
    </ContentContainer>
  )
}
