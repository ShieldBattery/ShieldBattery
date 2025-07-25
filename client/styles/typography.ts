import styled, { css } from 'styled-components'

export const singleLine = css`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export const inter = css`
  font-family: Inter, sans-serif;
  font-synthesis: style small-caps;
`

export const sofiaSans = css`
  font-family: 'Sofia Sans', Inter, sans-serif;
  font-synthesis: style small-caps;
`

export const sofiaSansCondensed = css`
  font-family: 'Sofia Sans Condensed', 'Sofia Sans', Inter, sans-serif;
  font-synthesis: style small-caps;
`

export const bodySmall = css`
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.4px;
  line-height: 16px;
`

export const BodySmall = styled.div`
  ${bodySmall};
`

export const bodyMedium = css`
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0px;
  line-height: 20px;
`

export const BodyMedium = styled.div`
  ${bodyMedium};
`

export const bodyLarge = css`
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0px;
  line-height: 24px;
`

export const BodyLarge = styled.div`
  ${bodyLarge};
`

export const labelSmall = css`
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.5px;
  line-height: 16px;
`

export const LabelSmall = styled.div`
  ${labelSmall};
`

export const labelMedium = css`
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.48px;
  line-height: 16px;
`

export const LabelMedium = styled.div`
  ${labelMedium};
`

export const labelLarge = css`
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.3px;
  line-height: 20px;
`

export const LabelLarge = styled.div`
  ${labelLarge};
`

export const titleTiny = css`
  ${sofiaSans};
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  line-height: 16px;
`

export const TitleTiny = styled.div`
  ${titleTiny};
`

export const titleSmall = css`
  ${sofiaSans};
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.4px;
  line-height: 20px;
`

export const TitleSmall = styled.div`
  ${titleSmall};
`

export const titleMedium = css`
  ${sofiaSans};
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.2px;
  line-height: 24px;
`

export const TitleMedium = styled.div`
  ${titleMedium};
`

export const titleLarge = css`
  ${sofiaSans};
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0px;
  line-height: 32px;
`

export const TitleLarge = styled.div`
  ${titleLarge};
`

export const headlineSmall = titleLarge
export const HeadlineSmall = TitleLarge

export const headlineMedium = css`
  ${sofiaSans};
  font-size: 30px;
  font-weight: 600;
  letter-spacing: 0px;
  line-height: 36px;
`

export const HeadlineMedium = styled.div`
  ${headlineMedium};
`

export const headlineLarge = css`
  ${sofiaSans};
  font-size: 34px;
  font-weight: 600;
  letter-spacing: 0px;
  line-height: 40px;
`

export const HeadlineLarge = styled.div`
  ${headlineLarge};
`

export const displaySmall = css`
  ${sofiaSansCondensed};
  font-size: 38px;
  font-weight: 400;
  line-height: 44px;
  letter-spacing: 0px;
`

export const DisplaySmall = styled.div`
  ${displaySmall};
`

export const displayMedium = css`
  ${sofiaSansCondensed};
  font-size: 47px;
  font-weight: 400;
  letter-spacing: 0px;
  line-height: 52px;
`

export const DisplayMedium = styled.div`
  ${displayMedium};
`

export const displayLarge = css`
  ${sofiaSansCondensed};
  font-size: 59px;
  font-weight: 400;
  letter-spacing: 0px;
  line-height: 64px;
`

export const DisplayLarge = styled.div`
  ${displayLarge};
`
