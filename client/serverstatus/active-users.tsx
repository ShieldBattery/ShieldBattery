import React from 'react'
import { useAppSelector } from '../redux-hooks'
import { Body1 } from '../styles/typography'

export function ActiveUserCount(props: { className?: string }) {
  const activeUsers = useAppSelector(s => s.serverStatus.activeUsers)
  return <Body1 className={props.className}>{activeUsers} online</Body1>
}
