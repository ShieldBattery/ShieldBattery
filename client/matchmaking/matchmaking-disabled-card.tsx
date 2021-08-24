import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { MatchmakingType } from '../../common/matchmaking'
import Card from '../material/card'
import { shadow8dp } from '../material/shadows'
import { useAppSelector } from '../redux-hooks'
import { colorTextSecondary } from '../styles/colors'
import { body1, Headline3, Headline5, Headline6, headline6, overline } from '../styles/typography'

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const Contents = styled(Card)`
  ${shadow8dp};

  position: relative;
  width: 384px;
  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
`

const DisabledText = styled.span`
  ${body1};
  margin: 24px 0 32px 0;
  overflow-wrap: break-word;
`

const ToText = styled.span`
  ${headline6};
  margin: 8px 0;
  color: ${colorTextSecondary};
`

const CountdownContainer = styled.div`
  display: flex;
  justify-content: center;
  margin: 48px 0 8px 0;
  padding: 0 16px;
`

const CountdownItemContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  &:not(:first-child) {
    margin-left: 32px;
  }
`

const CountdownItemText = styled.span`
  ${overline};
  color: ${colorTextSecondary};
`

export interface ConnectedMatchmakingDisabledCardProps {
  className?: string
  type: MatchmakingType
}

export function ConnectedMatchmakingDisabledCard({
  className,
  type,
}: ConnectedMatchmakingDisabledCardProps) {
  const status = useAppSelector(s => s.matchmakingStatus.byType.get(type))

  const [days, setDays] = useState('00')
  const [hours, setHours] = useState('00')
  const [minutes, setMinutes] = useState('00')
  const [seconds, setSeconds] = useState('00')

  const nextStartDate = status?.nextStartDate
  const nextEndDate = status?.nextEndDate
  useEffect(() => {
    const calculate = () => {
      const diff = Number(nextStartDate!) - Date.now()

      if (diff < 0) {
        return
      }

      const oneMinute = 60 * 1000
      const oneHour = oneMinute * 60
      const oneDay = oneHour * 24

      const days = `${Math.max(Math.floor(diff / oneDay), 0)}`.padStart(2, '0')
      const hours = `${Math.max(Math.floor((diff % oneDay) / oneHour), 0)}`.padStart(2, '0')
      const minutes = `${Math.max(Math.floor((diff % oneHour) / oneMinute), 0)}`.padStart(2, '0')
      const seconds = `${Math.max(Math.floor((diff % oneMinute) / 1000), 0)}`.padStart(2, '0')

      setDays(days)
      setHours(hours)
      setMinutes(minutes)
      setSeconds(seconds)
    }

    if (!nextStartDate) {
      return undefined
    }

    calculate()
    const timer = setInterval(calculate, 1000)
    return () => {
      clearTimeout(timer)
    }
  }, [nextStartDate])

  return (
    <Contents className={className}>
      <Headline5>Matchmaking Disabled</Headline5>
      <DisabledText>
        Matchmaking is sometimes shut down for maintenance and development, and is currently
        disabled. The next matchmaking period is:
      </DisabledText>
      {nextStartDate && Number(nextStartDate) > Date.now() ? (
        <>
          <Headline6>{dateFormat.format(nextStartDate)}</Headline6>
          {nextEndDate && nextEndDate > nextStartDate ? (
            <>
              <ToText>to</ToText>
              <Headline6>{dateFormat.format(nextEndDate)}</Headline6>
            </>
          ) : null}
          <CountdownContainer>
            <CountdownItemContainer>
              <CountdownItemText>Days</CountdownItemText>
              <Headline3>{days}</Headline3>
            </CountdownItemContainer>
            <CountdownItemContainer>
              <CountdownItemText>Hours</CountdownItemText>
              <Headline3>{hours}</Headline3>
            </CountdownItemContainer>
            <CountdownItemContainer>
              <CountdownItemText>Minutes</CountdownItemText>
              <Headline3>{minutes}</Headline3>
            </CountdownItemContainer>
            <CountdownItemContainer>
              <CountdownItemText>Seconds</CountdownItemText>
              <Headline3>{seconds}</Headline3>
            </CountdownItemContainer>
          </CountdownContainer>
        </>
      ) : (
        <Headline6>Soon™</Headline6>
      )}
    </Contents>
  )
}
