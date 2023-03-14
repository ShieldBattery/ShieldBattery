import React from 'react'
import styled from 'styled-components'
import { colorTextSecondary } from '../styles/colors'
import { caption } from '../styles/typography'

const VersionTextRoot = styled.div`
  ${caption};
  margin: 8px 0px 0px 0px;
  color: ${colorTextSecondary};
  letter-spacing: 1.25px;
`

const CUR_VERSION = __WEBPACK_ENV.VERSION

export function VersionText() {
  return <VersionTextRoot>v{CUR_VERSION}</VersionTextRoot>
}
