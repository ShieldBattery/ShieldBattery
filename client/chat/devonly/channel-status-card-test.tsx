import React, { useState } from 'react'
import styled from 'styled-components'
import { ChannelStatus, ChatServiceErrorCode, makeSbChannelId } from '../../../common/chat'
import Card from '../../material/card'
import CheckBox from '../../material/check-box'
import { TextField } from '../../material/text-field'
import { FetchError } from '../../network/fetch-errors'
import { Subtitle1 } from '../../styles/typography'
import { ChannelStatusCard } from '../channel-status-card'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 32px;
`

const SettingsCard = styled(Card)`
  width: 100%;
  max-width: 400px;
`

export function ChannelStatusCardTest() {
  const [channelStatus, setChannelStatus] = useState<ChannelStatus>({
    id: makeSbChannelId(1),
    name: 'ShieldBattery',
    private: false,
    userCount: 1337,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isUserInChannel, setIsUserInChannel] = useState(false)
  const [isUserBanned, setIsUserBanned] = useState(false)
  const [channelNotFound, setChannelNotFound] = useState(false)
  const [channelClosed, setChannelClosed] = useState(false)
  const [channelName, setChannelName] = useState('ShieldBattery')

  let findChannelErrorCode
  if (channelNotFound) {
    findChannelErrorCode = ChatServiceErrorCode.ChannelNotFound
  } else if (channelClosed) {
    findChannelErrorCode = ChatServiceErrorCode.ChannelClosed
  }

  const findChannelError = findChannelErrorCode
    ? new FetchError(
        new Response(),
        JSON.stringify({
          code: findChannelErrorCode,
        }),
      )
    : undefined

  const joinChannelError = isUserBanned
    ? new FetchError(
        new Response(),
        JSON.stringify({
          code: ChatServiceErrorCode.UserBanned,
        }),
      )
    : undefined

  return (
    <Container>
      <SettingsCard>
        <Subtitle1>Settings</Subtitle1>
        <CheckBox
          label='Is loading'
          checked={isLoading}
          onChange={() => setIsLoading(!isLoading)}
        />
        <CheckBox
          label='Is private'
          checked={channelStatus.private}
          onChange={() => setChannelStatus({ ...channelStatus, private: !channelStatus.private })}
        />
        <CheckBox
          label='Is user in channel'
          checked={isUserInChannel}
          onChange={() => setIsUserInChannel(!isUserInChannel)}
        />
        <CheckBox
          label='Is user banned'
          checked={isUserBanned}
          onChange={() => setIsUserBanned(!isUserBanned)}
        />
        <CheckBox
          label='Channel not found'
          checked={channelNotFound}
          onChange={() => setChannelNotFound(!channelNotFound)}
        />
        <CheckBox
          label='Channel closed'
          checked={channelClosed}
          onChange={() => setChannelClosed(!channelClosed)}
        />
        <TextField
          floatingLabel={true}
          label='Channel name'
          value={channelName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelName(e.target.value)}
        />
        <TextField
          floatingLabel={true}
          label='User count'
          value={String(channelStatus.userCount)}
          type='number'
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setChannelStatus({ ...channelStatus, userCount: Number(e.target.value) })
          }
        />
      </SettingsCard>

      <ChannelStatusCard
        channelName={channelName}
        channelStatus={!isLoading && !findChannelError ? channelStatus : undefined}
        isUserInChannel={isUserInChannel}
        findChannelError={findChannelError}
        joinChannelError={joinChannelError}
        onViewClick={() => {}}
        onJoinClick={() => {}}
      />
    </Container>
  )
}
