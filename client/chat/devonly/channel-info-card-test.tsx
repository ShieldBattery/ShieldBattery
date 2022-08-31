import React, { useState } from 'react'
import styled from 'styled-components'
import { ChannelInfo, makeSbChannelId } from '../../../common/chat'
import Card from '../../material/card'
import CheckBox from '../../material/check-box'
import { TextField } from '../../material/text-field'
import { Subtitle1 } from '../../styles/typography'
import { ChannelInfoCard } from '../channel-info-card'

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

export function ChannelInfoCardTest() {
  const [channelInfo, setChannelInfo] = useState<ChannelInfo>({
    id: makeSbChannelId(1),
    name: 'ShieldBattery',
    private: false,
    highTraffic: false,
    userCount: 1337,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isUserInChannel, setIsUserInChannel] = useState(false)
  const [isUserBanned, setIsUserBanned] = useState(false)
  const [isJoinInProgress, setIsJoinInProgress] = useState(false)
  const [isChannelNotFound, setIsChannelNotFound] = useState(false)
  const [channelName, setChannelName] = useState('ShieldBattery')

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
          checked={channelInfo.private}
          onChange={() => setChannelInfo({ ...channelInfo, private: !channelInfo.private })}
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
          label='Is channel not found'
          checked={isChannelNotFound}
          onChange={() => setIsChannelNotFound(!isChannelNotFound)}
        />
        <CheckBox
          label='Is join in progress'
          checked={isJoinInProgress}
          onChange={() => setIsJoinInProgress(!isJoinInProgress)}
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
          value={String(channelInfo.userCount)}
          type='number'
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setChannelInfo({ ...channelInfo, userCount: Number(e.target.value) })
          }
        />
      </SettingsCard>

      <ChannelInfoCard
        channelName={channelName}
        channelInfo={!isChannelNotFound ? channelInfo : undefined}
        isLoading={isLoading}
        isUserInChannel={isUserInChannel}
        isJoinInProgress={isJoinInProgress}
        isChannelNotFound={isChannelNotFound}
        isUserBanned={isUserBanned}
        onViewClick={() => {}}
        onJoinClick={() => {}}
      />
    </Container>
  )
}
