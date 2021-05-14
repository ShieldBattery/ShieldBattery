import styled from 'styled-components'
import { Label } from '../material/button'
import CheckBox from '../material/check-box'
import { fastOutSlowIn } from '../material/curve-constants'
import FlatButton from '../material/flat-button'
import PasswordTextField from '../material/password-text-field'
import TextField from '../material/text-field'
import { colorError, colorSuccess, colorTextSecondary } from '../styles/colors'
import { headline4 } from '../styles/typography'

export const AuthContent = styled.div`
  position: relative;
  width: 100%;
`

export const AuthTitle = styled.div`
  ${headline4};
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
  color: ${colorError};
`

export const SuccessContainer = styled.p`
  flex-grow: 1;
  color: ${colorSuccess};
`

export const AuthBottomAction = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 48px;
`

export const BottomActionButton = styled(FlatButton)`
  & ${Label} {
    color: ${colorTextSecondary};
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

export const ForgotActionButton = styled(FlatButton)`
  padding: 0 8px;

  & ${Label} {
    color: ${colorTextSecondary};
    font-weight: 400;
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

export const AuthContentContainer = styled.div`
  opacity: 1;
  transition: opacity 150ms ${fastOutSlowIn};

  ${props =>
    props.isLoading
      ? `
        pointer-events: none;
        opacity: 0;
      `
      : ''}}
`
