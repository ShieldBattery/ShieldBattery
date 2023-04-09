import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { colorTextFaint } from '../styles/colors'
import { subtitle1 } from '../styles/typography'

const Container = styled.div`
  width: 100%;
  max-width: 960px;
  height: 100%;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`

const WarningIcon = styled(MaterialIcon).attrs({ icon: 'warning' })`
  margin-bottom: 8px;
  color: ${colorTextFaint};
`

const Text = styled.span`
  ${subtitle1};
  color: ${colorTextFaint};
`

export function NoPermissionsDisplay() {
  return (
    <Container>
      <WarningIcon size={64} />
      <Text>Not enough permissions to access this page</Text>
    </Container>
  )
}
