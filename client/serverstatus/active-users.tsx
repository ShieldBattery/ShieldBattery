import React from 'react'
import { useSelector } from 'react-redux'
import { Body1 } from '../styles/typography'

export function ActiveUserCount(props: { className?: string }) {
  // TODO(tec27): Make a type for the root state
  const activeUsers = useSelector(s => (s as any).serverStatus.activeUsers)
  return <Body1 className={props.className}>{activeUsers} online</Body1>
}
