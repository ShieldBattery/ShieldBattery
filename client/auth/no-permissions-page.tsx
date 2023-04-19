import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { colorError, colorTextFaint } from '../styles/colors'
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

const ErrorIcon = styled(MaterialIcon).attrs({ icon: 'error' })`
  margin-bottom: 8px;
  color: ${colorError};
`

const Text = styled.span`
  ${subtitle1};
  color: ${colorTextFaint};
`

export function NoPermissionsPage() {
  return (
    <Container>
      <ErrorIcon size={64} />
      <Text>You don't have enough permissions to access this page.</Text>
    </Container>
  )
}
