import styled from 'styled-components'
import { Label, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { PasswordTextField } from '../material/password-text-field'
import { TextField } from '../material/text-field'
import { headlineMedium } from '../styles/typography'

export const AuthContent = styled.div`
  position: relative;
  width: 100%;
`

export const AuthTitle = styled.div`
  ${headlineMedium};
  text-align: center;
  margin: 0 0 32px;
`

export const AuthBody = styled.div`
  width: 100%;
  padding-left: 24%;
  padding-right: 24%;
`

export const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
`

export const ErrorsContainer = styled.div`
  flex-grow: 1;
  color: var(--theme-error);
`

export const SuccessContainer = styled.p`
  flex-grow: 1;
  color: var(--theme-success);
`

export const AuthBottomAction = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 48px;
`

export const BottomActionButton = styled(TextButton)`
  & ${Label} {
    color: var(--theme-on-surface-variant);
    font-weight: 400;
  }
`

export const FieldRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  margin-top: 16px;
`

export const RowEdge = styled.div`
  flex: 1 1 28%;
  align-self: flex-start;
  display: flex;
  justify-content: flex-end;
  max-width: 28%;
  height: 56px;
`

export const ForgotActionButton = styled(TextButton)`
  padding: 0 8px;

  & ${Label} {
    font-size: 12px;
  }
`

export const Spacer = styled.div`
  flex-grow: 1;
`

export const AuthTextField = styled(TextField)`
  flex-grow: 1;
`

export const AuthPasswordTextField = styled(PasswordTextField)`
  flex-grow: 1;
`

export const AuthCheckBox = styled(CheckBox)`
  flex: 1 1 33.33%;
  max-width: 33.33%;
  max-height: 100%;
`

export const AuthContentContainer = styled.div<{ $isLoading: boolean }>`
  opacity: ${props => (props.$isLoading ? '0' : '1')};
  pointer-events: ${props => (props.$isLoading ? 'none' : 'auto')};
  transition: opacity 150ms linear;
`
