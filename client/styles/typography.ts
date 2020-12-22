import styled, { css } from 'styled-components'

export const textSizeBody = '14px'
export const textSizeSubhead = '16px'
export const textSizeTitle = '20px'
export const textSizeHeadline = '24px'
export const textSizeDisplay1 = '34px'
export const textSizeDisplay2 = '45px'
export const textSizeDisplay3 = '56px'
export const textSizeDisplay4 = '112px'
export const textSizeCaption = '12px'
export const textSizeButton = '14px'

export const buttonText = css`
  font-size: ${textSizeButton};
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
`

export const Display4Old = styled.h1`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeDisplay4};
  font-weight: 300;
  letter-spacing: -0.01em;
  line-height: ${textSizeDisplay4};
`

export const Display3Old = styled.h1`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeDisplay3};
  font-weight: 400;
  letter-spacing: -0.005em;
  line-height: ${textSizeDisplay3};
`

export const Display1Old = styled.h2`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeDisplay1};
  font-weight: 400;
  line-height: 40px;
`

export const HeadlineOld = styled.h3`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeHeadline};
  font-weight: 400;
  line-height: 32px;
`

export const TitleOld = styled.h4`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeTitle};
  font-weight: 500;
  letter-spacing: 0.005em;
`

export const SubheadingOld = styled.h5`
  text-rendering: optimizeLegibility;
  font-size: ${textSizeSubhead};
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 24px;
`

export const CaptionOld = styled.h6`
  font-weight: 400;
  font-size: ${textSizeCaption};
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

export const singleLine = css`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export const robotoCondensed = css`
  font-family: 'Roboto Condensed', Roboto, sans-serif;
`
