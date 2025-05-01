import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { CenteredContentContainer } from '../../styles/centered-container'
import { TitleLarge } from '../../styles/typography'
import { ElevatedButton, FilledButton, IconButton, TextButton } from '../button'
import { Card } from '../card'
import { FloatingActionButton } from '../floating-action-button'

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
  margin-inline: auto;
  margin-top: 24px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;

  & > * {
    margin-top: 8px;
  }
`

const Row = styled.div`
  display: flex;
  gap: 8px;
`

export function ButtonsTest() {
  return (
    <CenteredContentContainer>
      <StyledCard>
        <TitleLarge>Press some buttons</TitleLarge>
        <Row>
          <FilledButton label='Filled' />
          <FilledButton label='Filled Icon' iconStart={<MaterialIcon icon='mood' size={18} />} />
          <FilledButton label='Filled disabled' disabled={true} />
        </Row>
        <Row>
          <ElevatedButton label='Elevated' />
          <ElevatedButton
            label='Elevated Icon'
            iconStart={<MaterialIcon icon='mood' size={18} />}
          />
          <ElevatedButton label='Elevated disabled' disabled={true} />
        </Row>
        <TextButton label='Flat normal' />
        <TextButton label='Flat normal disabled' disabled={true} />
        <TextButton label='Flat primary' color='primary' />
        <TextButton label='Flat primary disabled' color='primary' disabled={true} />
        <TextButton label='Flat accent' color='accent' />
        <TextButton label='Flat accent disabled' color='accent' disabled={true} />
        <IconButton icon={<MaterialIcon icon='magic_button' />} title='Icon button' />
        <IconButton
          icon={<MaterialIcon icon='local_pizza' />}
          title='Icon button disabled'
          disabled={true}
        />
        <FloatingActionButton
          icon={<MaterialIcon icon='elderly' invertColor={true} />}
          title='FAB'
        />
        <FloatingActionButton
          icon={<MaterialIcon icon='skull' invertColor={true} />}
          title='Disabled FAB'
          disabled={true}
        />
      </StyledCard>
    </CenteredContentContainer>
  )
}
