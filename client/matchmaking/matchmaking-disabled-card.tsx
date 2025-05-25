import React, { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MatchmakingType } from '../../common/matchmaking'
import { TransInterpolation } from '../i18n/i18next'
import { Card } from '../material/card'
import { elevationPlus3 } from '../material/shadows'
import { useAppSelector } from '../redux-hooks'
import { bodyMedium, DisplaySmall, labelMedium, TitleLarge, titleLarge } from '../styles/typography'

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const DisabledCard = styled(Card)`
  ${elevationPlus3};

  position: relative;
  width: 480px;
  padding: 24px;

  display: flex;
  flex-direction: column;
  align-items: center;
`

const DisabledText = styled.span`
  ${bodyMedium};
  margin: 24px 0 16px 0;
  overflow-wrap: break-word;
`

const ToText = styled.span`
  ${titleLarge};
  margin: 8px 0;
  color: var(--theme-on-surface-variant);
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
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

export interface ConnectedMatchmakingDisabledCardProps {
  className?: string
  type: MatchmakingType
}

export function ConnectedMatchmakingDisabledCard({
  className,
  type,
}: ConnectedMatchmakingDisabledCardProps) {
  const { t } = useTranslation()
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
      <TitleLarge>{t('matchmaking.disabledCard.title', 'Matchmaking disabled')}</TitleLarge>
      <DisabledText>
        <Trans t={t} i18nKey='matchmaking.disabledCard.description'>
          Matchmaking is sometimes shut down for maintenance and development, and is currently
          disabled. The next matchmaking period is:
        </Trans>
      </DisabledText>
      {nextStartDate && Number(nextStartDate) > Date.now() ? (
        <>
          {nextEndDate && nextEndDate > nextStartDate ? (
            <Trans t={t} i18nKey='matchmaking.disabledCard.nextDateRange'>
              <TitleLarge>
                {{ nextStartDate: dateFormat.format(nextStartDate) } as TransInterpolation}
              </TitleLarge>
              <ToText>to</ToText>
              <TitleLarge>
                {{ nextEndDate: dateFormat.format(nextEndDate) } as TransInterpolation}
              </TitleLarge>
            </Trans>
          ) : (
            <TitleLarge>{dateFormat.format(nextStartDate)}</TitleLarge>
          )}
          <CountdownContainer>
            <CountdownItemContainer>
              <CountdownItemText>{t('matchmaking.disabledCard.days', 'Days')}</CountdownItemText>
              <DisplaySmall>{days}</DisplaySmall>
            </CountdownItemContainer>
            <CountdownItemContainer>
              <CountdownItemText>{t('matchmaking.disabledCard.hours', 'Hours')}</CountdownItemText>
              <DisplaySmall>{hours}</DisplaySmall>
            </CountdownItemContainer>
            <CountdownItemContainer>
              <CountdownItemText>
                {t('matchmaking.disabledCard.minutes', 'Minutes')}
              </CountdownItemText>
              <DisplaySmall>{minutes}</DisplaySmall>
            </CountdownItemContainer>
            <CountdownItemContainer>
              <CountdownItemText>
                {t('matchmaking.disabledCard.seconds', 'Seconds')}
              </CountdownItemText>
              <DisplaySmall>{seconds}</DisplaySmall>
            </CountdownItemContainer>
          </CountdownContainer>
        </>
      ) : (
        <TitleLarge>{t('matchmaking.disabledCard.soon', 'Soon™')}</TitleLarge>
      )}
    </DisabledCard>
  )
}
