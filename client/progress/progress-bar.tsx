import styled from 'styled-components'

/** The groove a progress fill sits in. */
export const ProgressTrack = styled.div`
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background-color: var(--theme-container-highest);
`

const ProgressFill = styled.div<{ $scale: number }>`
  position: absolute;
  inset: 0;
  border-radius: 2px;
  background-color: var(--theme-amber);
  transform: ${props => `scaleX(${props.$scale})`};
  transform-origin: 0% 50%;
  transition: transform 120ms linear;
  will-change: transform;
`

/** A slim determinate progress bar. `value` is how far along it is, from 0 to 1. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <ProgressTrack className={className}>
      <ProgressFill $scale={Math.min(1, Math.max(0, value))} />
    </ProgressTrack>
  )
}
