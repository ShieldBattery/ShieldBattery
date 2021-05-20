import styled from 'styled-components'
import Avatar from '../avatars/avatar'
import { headline6, singleLine } from '../styles/typography'

export const PopoverContents = styled.div`
  min-width: 224px;
`

export const Header = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 24px;
`

export const StyledAvatar = styled(Avatar)`
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
`

export const Username = styled.div`
  ${headline6};
  ${singleLine};
`

export const Actions = styled.div`
  padding-top: 8px;
  padding-bottom: 8px;
`
