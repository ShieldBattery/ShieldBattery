import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { CenteredContentContainer } from '../../styles/centered-container'
import { TitleLarge } from '../../styles/typography'
import {
  ElevatedButton,
  FilledButton,
  FilledTonalButton,
  IconButton,
  OutlinedButton,
  TextButton,
} from '../button'
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
          <FilledButton label='Filled icon' iconStart={<MaterialIcon icon='mood' size={20} />} />
          <FilledButton label='Filled disabled' disabled={true} />
        </Row>
        <Row>
          <FilledTonalButton label='Filled Tonal' />
          <FilledTonalButton
            label='Filled Tonal icon'
            iconStart={<MaterialIcon icon='mood' size={20} />}
          />
          <FilledTonalButton label='Filled Tonal disabled' disabled={true} />
        </Row>
        <Row>
          <ElevatedButton label='Elevated' />
          <ElevatedButton
            label='Elevated icon'
            iconStart={<MaterialIcon icon='mood' size={20} />}
          />
          <ElevatedButton label='Elevated disabled' disabled={true} />
        </Row>
        <Row>
          <OutlinedButton label='Outlined' />
          <OutlinedButton
            label='Outlined icon'
            iconStart={<MaterialIcon icon='mood' size={20} />}
          />
          <OutlinedButton label='Outlined disabled' disabled={true} />
        </Row>
        <Row>
          <TextButton label='Text' />
          <TextButton label='Text icon' iconStart={<MaterialIcon icon='mood' size={20} />} />
          <TextButton label='Text disabled' disabled={true} />
        </Row>
        <Row>
          <IconButton icon={<MaterialIcon icon='magic_button' />} title='Icon button' />
          <IconButton
            icon={<MaterialIcon icon='local_pizza' />}
            title='Icon button disabled'
            disabled={true}
          />
        </Row>
        <Row>
          <FloatingActionButton
            icon={<MaterialIcon icon='elderly' invertColor={true} />}
            title='FAB'
          />
          <FloatingActionButton
            icon={<MaterialIcon icon='skull' invertColor={true} />}
            title='Disabled FAB'
            disabled={true}
          />
        </Row>
      </StyledCard>
    </CenteredContentContainer>
  )
}
