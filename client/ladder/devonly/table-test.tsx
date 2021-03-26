import { List } from 'immutable'
import React from 'react'
import { LadderPlayer, LadderTable } from '../ladder'

const PLAYERS: LadderPlayer[] = []

let curRating = 2200
const NOW = Date.now()
for (let i = 0; i < 1000; i++) {
  // Generate a random name between 3 and 16 characters long
  const name = (
    Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8)
  ).substring(0, Math.floor(Math.random() * 14) + 3)

  const rating = curRating
  curRating -= Math.random() * 3

  const wins = Math.floor(Math.random() * 100) + 5
  const losses = Math.floor(Math.random() * 100) + 5
  const lastPlayedDate = NOW - (Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000) + 1000)

  PLAYERS.push({
    rank: i + 1,
    user: {
      id: i,
      name,
    },
    rating,
    wins,
    losses,
    lastPlayedDate,
  })
}

export function TableTest() {
  return <LadderTable players={List(PLAYERS)} />
}
