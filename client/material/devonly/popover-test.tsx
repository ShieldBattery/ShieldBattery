import { useState } from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import {
  OriginX,
  OriginY,
  Popover,
  usePopoverController,
  useRefAnchorPosition,
} from '../../material/popover'
import { BodyLarge, HeadlineMedium, TitleLarge } from '../../styles/typography'
import { IconButton } from '../button'
import { SelectOption } from '../select/option'
import { Select } from '../select/select'

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

  const [topLeftOpen, openTopLeft, closeTopLeft] = usePopoverController()
  const [topRightOpen, openTopRight, closeTopRight] = usePopoverController()
  const [bottomLeftOpen, openBottomLeft, closeBottomLeft] = usePopoverController()
  const [bottomRightOpen, openBottomRight, closeBottomRight] = usePopoverController()

  const [topLeftAnchor, topLeftAnchorX, topLeftAnchorY] = useRefAnchorPosition(
    anchorOriginX,
    anchorOriginY,
  )
  const [topRightAnchor, topRightAnchorX, topRightAnchorY] = useRefAnchorPosition(
    anchorOriginX,
    anchorOriginY,
  )
  const [bottomLeftAnchor, bottomLeftAnchorX, bottomLeftAnchorY] = useRefAnchorPosition(
    anchorOriginX,
    anchorOriginY,
  )
  const [bottomRightAnchor, bottomRightAnchorX, bottomRightAnchorY] = useRefAnchorPosition(
    anchorOriginX,
    anchorOriginY,
  )

  const popoverContents = (
    <PopoverScrollable>
      <PopoverContents>
        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>

        <HeadlineMedium>Hello</HeadlineMedium>
        <TitleLarge>World</TitleLarge>
        <BodyLarge>How are you?</BodyLarge>
      </PopoverContents>
    </PopoverScrollable>
  )

  return (
    <Container>
      <Content>
        <TopLeftButton
          ref={topLeftAnchor}
          icon={<MaterialIcon icon='more_vert' />}
          onClick={openTopLeft}
        />
        <TopRightButton
          ref={topRightAnchor}
          icon={<MaterialIcon icon='more_vert' />}
          onClick={openTopRight}
        />
        <BottomLeftButton
          ref={bottomLeftAnchor}
          icon={<MaterialIcon icon='more_vert' />}
          onClick={openBottomLeft}
        />
        <BottomRightButton
          ref={bottomRightAnchor}
          icon={<MaterialIcon icon='more_vert' />}
          onClick={openBottomRight}
        />

        <OptionsContainer>
          <Select value={anchorOriginX} label='Anchor origin X' onChange={setAnchorOriginX}>
            <SelectOption value='left' text='Left' />
            <SelectOption value='center' text='Center' />
            <SelectOption value='right' text='Right' />
          </Select>
          <Select value={anchorOriginY} label='Anchor origin Y' onChange={setAnchorOriginY}>
            <SelectOption value='top' text='Top' />
            <SelectOption value='center' text='Center' />
            <SelectOption value='bottom' text='Bottom' />
          </Select>
          <Select value={popoverOriginX} label='Popover origin X' onChange={setPopoverOriginX}>
            <SelectOption value='left' text='Left' />
            <SelectOption value='center' text='Center' />
            <SelectOption value='right' text='Right' />
          </Select>
          <Select value={popoverOriginY} label='Popover origin Y' onChange={setPopoverOriginY}>
            <SelectOption value='top' text='Top' />
            <SelectOption value='center' text='Center' />
            <SelectOption value='bottom' text='Bottom' />
          </Select>
        </OptionsContainer>

        <Popover
          open={topLeftOpen}
          onDismiss={closeTopLeft}
          originX={popoverOriginX}
          originY={popoverOriginY}
          anchorX={topLeftAnchorX ?? 0}
          anchorY={topLeftAnchorY ?? 0}>
          {popoverContents}
        </Popover>

        <Popover
          open={topRightOpen}
          onDismiss={closeTopRight}
          originX={popoverOriginX}
          originY={popoverOriginY}
          anchorX={topRightAnchorX ?? 0}
          anchorY={topRightAnchorY ?? 0}>
          {popoverContents}
        </Popover>

        <Popover
          open={bottomLeftOpen}
          onDismiss={closeBottomLeft}
          originX={popoverOriginX}
          originY={popoverOriginY}
          anchorX={bottomLeftAnchorX ?? 0}
          anchorY={bottomLeftAnchorY ?? 0}>
          {popoverContents}
        </Popover>

        <Popover
          open={bottomRightOpen}
          onDismiss={closeBottomRight}
          originX={popoverOriginX}
          originY={popoverOriginY}
          anchorX={bottomRightAnchorX ?? 0}
          anchorY={bottomRightAnchorY ?? 0}>
          {popoverContents}
        </Popover>
      </Content>
    </Container>
  )
}
