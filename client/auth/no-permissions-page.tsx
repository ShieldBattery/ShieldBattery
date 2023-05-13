import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  return (
    <Container>
      <ErrorIcon size={64} />
      <Text>
        <Trans t={t} i18nKey='auth.noPermissionsPage.body'>
          You don't have enough permissions to access this page.
        </Trans>
      </Text>
    </Container>
  )
}
