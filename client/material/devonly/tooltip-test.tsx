import React from 'react'
import styled from 'styled-components'
import { Tooltip } from '../tooltip'

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px !important;
  padding-top: 64px !important;
`

const Content = styled.div`
  position: relative;
  height: 80%;
  max-width: 960px;
  min-height: 512px;
  margin: 0px auto;
  border-left: var(--pixel-shove-x, 0) solid transparent;
`

const StyledTooltipTarget = styled(Tooltip)`
  display: inline-block;
  margin: 0 16px;
`

const ContentComponent = styled.div`
  background-color: red;
  border-radius: 50%;
`

export function TooltipTest() {
  return (
    <Container>
      <Content>
        <StyledTooltipTarget text="Hi. I'm a tooltip!" position='bottom'>
          <span>Tooltip at bottom</span>
        </StyledTooltipTarget>
        <StyledTooltipTarget text="Hi. I'm a tooltip!" position='top'>
          <span>Tooltip at top</span>
        </StyledTooltipTarget>
        <StyledTooltipTarget text="Hi. I'm a tooltip!" position='left'>
          <span>Tooltip at left side</span>
        </StyledTooltipTarget>
        <StyledTooltipTarget text="Hi. I'm a tooltip!" position='right'>
          <span>Tooltip at right side</span>
        </StyledTooltipTarget>
        <StyledTooltipTarget text="Hi. I'm a tooltip!" ContentComponent={ContentComponent}>
          <span>Tooltip with custom content component</span>
        </StyledTooltipTarget>
      </Content>
    </Container>
  )
}
