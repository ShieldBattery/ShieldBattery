import styled from 'styled-components'

import { Label } from '../button.jsx'
import IconButton from '../icon-button.jsx'

import { colorTextSecondary } from '../../styles/colors.ts'

const SubheaderButton = styled(IconButton)`
  min-height: 32px;
  width: 32px;
  padding: 0;
  line-height: 32px;
  margin-right: 4px;

  & ${Label} {
    color: ${colorTextSecondary};
    line-height: 32px;
  }
`

export default SubheaderButton
