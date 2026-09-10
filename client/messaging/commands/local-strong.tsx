import styled from 'styled-components'
import { titleSmall } from '../../styles/typography'

/**
 * A strong part of an only-you line, such as a user or channel name or a command usage. The colour
 * comes from the surrounding line: the same blue95 as `SystemImportant` inside an info line, and the
 * error colour inside an error line.
 */
export const LocalStrong = styled.span`
  ${titleSmall};
  line-height: inherit;
  color: inherit;
`
