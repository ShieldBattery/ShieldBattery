import React from 'react'
import styled from 'styled-components'
import { amberA400, colorDividers, colorError } from '../styles/colors'
import { fastOutSlowInShort } from './curves'

const UnderlineContainer = styled.div<{ $error?: boolean }>`
  order: 3;
  position: absolute;
  left: 0;
  bottom: 0;
  right: 0;
  width: 100%;
  margin: 0;
  pointer-events: none;
  color: ${props => (props.$error ? colorError : amberA400)};
`

const Underline = styled.hr<{ $error?: boolean }>`
  width: 100%;
  margin: 0;
  border: none;
  border-bottom: 2px solid ${colorDividers};
  ${props => (props.$error ? `border-color: ${colorError}` : '')};
`

const FocusedUnderline = styled(Underline)<{ $focused?: boolean }>`
  position: absolute;
  top: 0px;
  width: 100%;
  margin-top: 0px;
  color: inherit;
  border-bottom-width: 2px;
  border-color: currentColor;
  transform: ${props => (props.$focused ? 'scaleX(1)' : 'scaleX(0)')};
  ${fastOutSlowInShort};
`

export const InputUnderline = ({
  disabled,
  error,
  focused,
}: {
  disabled?: boolean
  error?: boolean
  focused?: boolean
}) => {
  if (disabled) {
    return null
  }

  return (
    <UnderlineContainer $error={error}>
      <Underline $error={error} />
      <FocusedUnderline $focused={focused} />
    </UnderlineContainer>
  )
}
