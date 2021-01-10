import styled from 'styled-components'

import { Label } from '../button'
import IconButton from '../icon-button'

import { colorTextSecondary } from '../../styles/colors'

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
