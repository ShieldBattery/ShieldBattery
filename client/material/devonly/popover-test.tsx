import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import VertMenuIcon from '../../icons/material/ic_more_vert_black_24px.svg'
import { OriginX, OriginY, Popover, useAnchorPosition } from '../../material/popover'
import { Headline4, Headline5, Subtitle1 } from '../../styles/typography'
import IconButton from '../icon-button'
import Option from '../select/option'
import Select from '../select/select'

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

const OptionsContainer = styled.div`
  width: 256px;
  margin: 0px auto;
`

const StyledIconButton = styled(IconButton)`
  position: absolute;
`

const TopLeftButton = styled(StyledIconButton)`
  top: 16px;
  left: 16px;
`

const TopRightButton = styled(StyledIconButton)`
  top: 16px;
  right: 16px;
`

const BottomLeftButton = styled(StyledIconButton)`
  bottom: 16px;
  left: 16px;
`

const BottomRightButton = styled(StyledIconButton)`
  bottom: 16px;
  right: 16px;
`

const PopoverScrollable = styled.div`
  max-height: calc(var(--sb-popover-max-height) * 0.667);
  overflow-y: auto;
`

const PopoverContents = styled.div`
  min-width: 256px;
  padding: 16px;
`

export default function PopoverTest() {
  const [anchorOriginX, setAnchorOriginX] = useState<OriginX>('left')
  const [anchorOriginY, setAnchorOriginY] = useState<OriginY>('top')
  const [popoverOriginX, setPopoverOriginX] = useState<OriginX>('left')
  const [popoverOriginY, setPopoverOriginY] = useState<OriginY>('top')

  const [anchorElem, setAnchorElem] = useState<HTMLElement>()
  const onButtonClick = useCallback((event: React.MouseEvent) => {
    setAnchorElem(event.currentTarget as HTMLElement)
  }, [])
  const onDismiss = useCallback(() => {
    setAnchorElem(undefined)
  }, [])
  const [, anchorX, anchorY] = useAnchorPosition(anchorOriginX, anchorOriginY, anchorElem ?? null)

  return (
    <Container>
      <Content>
        <TopLeftButton icon={<VertMenuIcon />} onClick={onButtonClick} />
        <TopRightButton icon={<VertMenuIcon />} onClick={onButtonClick} />
        <BottomLeftButton icon={<VertMenuIcon />} onClick={onButtonClick} />
        <BottomRightButton icon={<VertMenuIcon />} onClick={onButtonClick} />

        <OptionsContainer>
          <Select value={anchorOriginX} label='Anchor origin X' onChange={setAnchorOriginX}>
            <Option value='left' text='Left' />
            <Option value='center' text='Center' />
            <Option value='right' text='Right' />
          </Select>
          <Select value={anchorOriginY} label='Anchor origin Y' onChange={setAnchorOriginY}>
            <Option value='top' text='Top' />
            <Option value='center' text='Center' />
            <Option value='bottom' text='Bottom' />
          </Select>
          <Select value={popoverOriginX} label='Popover origin X' onChange={setPopoverOriginX}>
            <Option value='left' text='Left' />
            <Option value='center' text='Center' />
            <Option value='right' text='Right' />
          </Select>
          <Select value={popoverOriginY} label='Popover origin Y' onChange={setPopoverOriginY}>
            <Option value='top' text='Top' />
            <Option value='center' text='Center' />
            <Option value='bottom' text='Bottom' />
          </Select>
        </OptionsContainer>

        <Popover
          open={!!anchorElem}
          onDismiss={onDismiss}
          originX={popoverOriginX}
          originY={popoverOriginY}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}>
          <PopoverScrollable>
            <PopoverContents>
              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>

              <Headline4>Hello</Headline4>
              <Headline5>World</Headline5>
              <Subtitle1>How are you?</Subtitle1>
            </PopoverContents>
          </PopoverScrollable>
        </Popover>
      </Content>
    </Container>
  )
}
