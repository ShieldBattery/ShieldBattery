import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyLarge } from '../styles/typography'

const Container = styled.div`
  width: 100%;
  max-width: 960px;
  height: 100%;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`

const ErrorIcon = styledWithAttrs(MaterialIcon, { icon: 'error' })`
  margin-bottom: 8px;
  color: var(--theme-error);
`

const Text = styled.span`
  ${bodyLarge};
  color: var(--theme-on-surface);
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
