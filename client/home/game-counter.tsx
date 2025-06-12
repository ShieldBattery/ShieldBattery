import { MotionValue, useSpring, useTransform } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { range } from '../../common/range'
import { apiUrl } from '../../common/urls'
import { elevationPlus1 } from '../material/shadows'
import { makeServerUrl } from '../network/server-url'
import { ContainerLevel, containerStyles } from '../styles/colors'

export function GameCounter({ className, height }: { className?: string; height: number }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(0)

  useEffect(() => {
    let isFirstSet = true
    let timeout: ReturnType<typeof setTimeout> | undefined

    const eventSource = new EventSource(IS_ELECTRON ? makeServerUrl(apiUrl`games`) : apiUrl`games`)

    eventSource.addEventListener('gameCount', event => {
      if (timeout) {
        clearTimeout(timeout)
      }

      const count = (event as any).data as number
      if (isFirstSet) {
        // If we're setting the value for the first time, set all the digits to 5 so that they all
        // animate
        const numDigits = String(count).length
        setValue(Number('5'.repeat(numDigits)))
      }

      setTimeout(() => {
        isFirstSet = false
        setValue(count)
        timeout = undefined
      }, 200)
    })

    return () => {
      eventSource.close()
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }, [])

  return (
    <div className={className}>
      <Trans t={t} i18nKey='landing.splash.gameCount'>
        <GameCountNumber value={value} height={height} />
        <span className='games-played'>games played</span>
      </Trans>
    </div>
  )
}

const GameCountNumberRoot = styled(m.span)`
  ${containerStyles(ContainerLevel.Normal)};
  ${elevationPlus1};

  padding-inline: 6px 4px;

  display: flex;
  overflow: hidden;

  border-radius: 4px;
`

export function GameCountNumber({ value: _value, height }: { value: number; height: number }) {
  const value = Math.abs(_value)
  const valueStr = String(value)
  const maxDigits = valueStr.length

  return (
    <GameCountNumberRoot layout={'size'} aria-label={valueStr} style={{ height: `${height}px` }}>
      {Array.from(range(0, maxDigits), i => (
        <DigitGroup key={i} place={10 ** (maxDigits - i - 1)} value={value} height={height} />
      ))}
    </GameCountNumberRoot>
  )
}

const DigitGroupRoot = styled.div`
  position: relative;
  width: calc(1ch + 4px);
  padding: 2px;

  font-variant-numeric: tabular-nums;
`

function DigitGroup({ place, value, height }: { place: number; value: number; height: number }) {
  const valueRoundedToPlace = Math.floor(value / place)
  const animatedValue = useSpring(valueRoundedToPlace, {
    mass: 4,
    damping: 50,
    stiffness: 600,
  })

  useEffect(() => {
    animatedValue.set(valueRoundedToPlace)
  }, [animatedValue, valueRoundedToPlace])

  return (
    <DigitGroupRoot style={{ height: `${height}px` }}>
      <Digit motionValue={animatedValue} digit={0} height={height} />
      <Digit motionValue={animatedValue} digit={1} height={height} />
      <Digit motionValue={animatedValue} digit={2} height={height} />
      <Digit motionValue={animatedValue} digit={3} height={height} />
      <Digit motionValue={animatedValue} digit={4} height={height} />
      <Digit motionValue={animatedValue} digit={5} height={height} />
      <Digit motionValue={animatedValue} digit={6} height={height} />
      <Digit motionValue={animatedValue} digit={7} height={height} />
      <Digit motionValue={animatedValue} digit={8} height={height} />
      <Digit motionValue={animatedValue} digit={9} height={height} />
    </DigitGroupRoot>
  )
}

const DigitRoot = styled(m.span)`
  position: absolute;
  inset: 0;

  display: flex;
  align-items: center;
`

function Digit({
  motionValue,
  digit,
  height,
}: {
  motionValue: MotionValue
  digit: number
  height: number
}) {
  const y = useTransform(motionValue, latest => {
    const placeValue = latest % 10
    const offset = (10 + digit - placeValue) % 10

    // When we get more than 5 away from the current digit, move it back to the top
    return offset <= 5 ? offset * height : (offset - 10) * height
  })

  return <DigitRoot style={{ y }}>{digit}</DigitRoot>
}
