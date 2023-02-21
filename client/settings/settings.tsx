import React, { useCallback, useEffect } from 'react'
import { assertUnreachable } from '../../common/assert-unreachable'
import { TypedIpcRenderer } from '../../common/ipc'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { changeSettingsSubPage, closeSettings } from './action-creators'
import AppSettings from './app-settings'
import GameplaySettings from './gameplay-settings'
import InputSettings from './input-settings'
import {
  AppSettingsSubPage,
  GameSettingsSubPage,
  SettingsSubPage,
  UserSettingsSubPage,
} from './settings-sub-page'
import SoundSettings from './sound-settings'
import VideoSettings from './video-settings'

const ipcRenderer = new TypedIpcRenderer()

export function Settings() {
  const dispatch = useAppDispatch()
  const isOpen = useAppSelector(s => s.settings.open)
  const subPage = useAppSelector(s => s.settings.subPage)

  useEffect(() => {
    // FIXME(2Pac): Handle errors
    ipcRenderer.invoke('settingsLocalGet')
    ipcRenderer.invoke('settingsScrGet')
  }, [])

  const onSubPageChange = useCallback(
    (value: SettingsSubPage) => {
      dispatch(changeSettingsSubPage(value))
    },
    [dispatch],
  )
  const onCloseSettings = useCallback(() => {
    dispatch(closeSettings())
  }, [dispatch])

  let contents: React.ReactNode
  switch (subPage) {
    case UserSettingsSubPage.Account:
      contents = <AppSettings />
      break
    case AppSettingsSubPage.Sound:
    case AppSettingsSubPage.System:
      contents = <AppSettings />
      break
    case GameSettingsSubPage.StarCraftPath:
    case GameSettingsSubPage.Input:
      contents = <InputSettings />
      break
    case GameSettingsSubPage.Sound:
      contents = <SoundSettings />
      break
    case GameSettingsSubPage.Video:
      contents = <VideoSettings />
      break
    case GameSettingsSubPage.Gameplay:
      contents = <GameplaySettings />
      break
    default:
      contents = assertUnreachable(subPage)
  }

  return (
    <Container>
      <NavContainer>
        <NavSectionTitle>User settings</NavSectionTitle>
        <NavLink>Account details</NavLink>

        <NavSectionSeparator />

        <NavSectionTitle>App settings</NavSectionTitle>
        <NavLink>Sound</NavLink>
        <NavLink>System</NavLink>

        <NavSectionSeparator />

        <NavSectionTitle>Game settings</NavSectionTitle>
        <NavLink>StarCraft path</NavLink>
        <NavLink>Input</NavLink>
        <NavLink>Sound</NavLink>
        <NavLink>Video</NavLink>
        <NavLink>Gameplay</NavLink>
      </NavContainer>

      <ContentContainer>{contents}</ContentContainer>
    </Container>
  )
}
