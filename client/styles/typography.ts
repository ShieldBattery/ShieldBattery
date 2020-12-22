import styled, { css } from 'styled-components'

export const textSizeButton = '14px'

export const singleLine = css`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export const robotoCondensed = css`
  font-family: 'Roboto Condensed', Roboto, sans-serif;
`

export const buttonText = css`
  font-size: ${textSizeButton};
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
`

const textSizeSubheadOld = '16px'
const textSizeTitleOld = '20px'
const textSizeHeadlineOld = '24px'
const textSizeDisplay1Old = '34px'
const textSizeDisplay3Old = '56px'
const textSizeDisplay4Old = '112px'
const textSizeCaptionOld = '12px'

export const Display4Old = styled.h1`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeDisplay4Old};
  font-weight: 300;
  letter-spacing: -0.01em;
  line-height: ${textSizeDisplay4Old};
`

export const Display3Old = styled.h1`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeDisplay3Old};
  font-weight: 400;
  letter-spacing: -0.005em;
  line-height: ${textSizeDisplay3Old};
`

export const Display1Old = styled.h2`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeDisplay1Old};
  font-weight: 400;
  line-height: 40px;
`

export const HeadlineOld = styled.h3`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeHeadlineOld};
  font-weight: 400;
  line-height: 32px;
`

export const TitleOld = styled.h4`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeTitleOld};
  font-weight: 500;
  letter-spacing: 0.005em;
`

export const SubheadingOld = styled.h5`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeSubheadOld};
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 24px;
`

export const CaptionOld = styled.h6`
  font-weight: 400;
  font-size: ${textSizeCaptionOld};
  letter-spacing: 0.02em;
`

export const Body2Old = styled.span`
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 24px;
`

export const Body1Old = styled.span`
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 20px;
`
