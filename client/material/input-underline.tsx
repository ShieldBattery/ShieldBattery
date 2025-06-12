import styled from 'styled-components'
import { fastOutSlowInShort } from './curves'

const UnderlineContainer = styled.div<{ $error?: boolean; $focused?: boolean }>`
  position: absolute;
  left: 0;
  bottom: 0;
  right: 0;
  height: 3px;

  color: ${props => (props.$error ? 'var(--theme-error)' : 'var(--theme-amber)')};
  pointer-events: none;

  --_inactive-underline-color: ${props =>
    props.$error ? 'var(--theme-error)' : 'var(--theme-on-surface-variant)'};
  --_focused-underline-opacity: ${props => (props.$focused ? '1' : '0')};
  --_hover-underline-color: ${props =>
    props.$error ? 'var(--theme-error)' : 'var(--theme-on-surface)'};

  *:hover > & {
    --_inactive-underline-color: var(--_hover-underline-color);
  }
`

const Underline = styled.hr`
  box-sizing: border-box;

  width: 100%;
  height: 100%;
  margin: 0;

  border: none;
  border-bottom: 1px solid var(--_inactive-underline-color, --theme-on-surface-variant);
`

const FocusedUnderline = styled(Underline)`
  position: absolute;
  top: 0px;
  width: 100%;
  margin-top: 0px;
  color: inherit;
  border-bottom-width: 3px;
  border-color: currentColor;
  opacity: var(--_focused-underline-opacity, 0);
  ${fastOutSlowInShort};
`

export const InputUnderline = ({ error, focused }: { error?: boolean; focused?: boolean }) => {
  return (
    <UnderlineContainer $error={error} $focused={focused}>
      <Underline />
      <FocusedUnderline />
    </UnderlineContainer>
  )
}
