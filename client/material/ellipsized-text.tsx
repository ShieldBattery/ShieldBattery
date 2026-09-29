import styled from 'styled-components'
import { useOverflowingElement } from '../dom/overflowing-element'
import { singleLine } from '../styles/typography'
import { Tooltip, TooltipPosition } from './tooltip'

const Text = styled.span`
  ${singleLine};
  display: block;
  min-width: 0;
`

/**
 * One line of text that ellipsizes when it runs out of room, with a Tooltip showing all of it only
 * while it's actually cut off. The `className` styles the wrapper, so size and typography set there
 * apply to the text.
 */
export function EllipsizedText({
  text,
  position = 'top',
  className,
}: {
  text: string
  position?: TooltipPosition
  className?: string
}) {
  const [ref, isOverflowing] = useOverflowingElement<HTMLSpanElement>()

  return (
    <Tooltip
      text={text}
      position={position}
      disabled={!isOverflowing}
      tabIndex={-1}
      className={className}>
      <Text ref={ref}>{text}</Text>
    </Tooltip>
  )
}
