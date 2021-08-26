import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { MatchmakingType } from '../../common/matchmaking'
import { DisabledCard, DisabledText } from '../activities/disabled-content'
import { useSelfUser } from '../auth/state-hooks'
import { useAppSelector } from '../redux-hooks'
import { colorTextSecondary } from '../styles/colors'
import { Headline3, Headline5, Headline6, headline6, overline } from '../styles/typography'

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

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
    <DisabledCard className={className}>
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
    </DisabledCard>
  )
}

export interface ConnectedPartyDisabledCardProps {
  className?: string
  type: MatchmakingType
}

export function ConnectedPartyDisabledCard({ className, type }: ConnectedPartyDisabledCardProps) {
  const selfUser = useSelfUser()
  const isPartyLeader = useAppSelector(s => s.party.leader.id === selfUser.id)
  const partySize = useAppSelector(s => s.party.members.size)

  let disabledText: string | undefined
  if (!isPartyLeader) {
    disabledText = `Only party leader can queue for a match.`
  } else if (
    (type === MatchmakingType.Match1v1 && partySize > 1) ||
    (type === MatchmakingType.Match2v2 && partySize > 2)
  ) {
    disabledText = `Your current party is too large to queue for this matchmaking type.`
  }

  return (
    <DisabledCard className={className}>
      <Headline5>Matchmaking Disabled</Headline5>
      <DisabledText>{disabledText}</DisabledText>
    </DisabledCard>
  )
}
