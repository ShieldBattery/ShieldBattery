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

const TooltipTarget = styled.span`
  margin: 16px;
`

export function TooltipTest() {
  return (
    <Container>
      <Content>
        <Tooltip text="Hi. I'm a tooltip!" position='bottom'>
          <TooltipTarget>Tooltip at bottom</TooltipTarget>
        </Tooltip>
        <Tooltip text="Hi. I'm a tooltip!" position='top'>
          <TooltipTarget>Tooltip at top</TooltipTarget>
        </Tooltip>
        <Tooltip text="Hi. I'm a tooltip!" position='left'>
          <TooltipTarget>Tooltip at left side</TooltipTarget>
        </Tooltip>
        <Tooltip text="Hi. I'm a tooltip!" position='right'>
          <TooltipTarget>Tooltip at right side</TooltipTarget>
        </Tooltip>
      </Content>
    </Container>
  )
}
