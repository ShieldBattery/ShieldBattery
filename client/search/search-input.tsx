import React, { useCallback, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import SearchIcon from '../icons/material/baseline-search-24px.svg'
import { useKeyListener } from '../keyboard/key-listener'
import { fastOutSlowInShort } from '../material/curves'
import TextField from '../material/text-field'
import { useValueAsRef } from '../state-hooks'

const ESCAPE = 'Escape'
const F = 'KeyF'

const TextFieldContainer = styled(TextField)`
  ${props =>
    props.isFocused
      ? css`
          width: var(--sb-search-input-focused-width, 250px);
        `
      : css`
          width: var(--sb-search-input-width, 200px);
        `}

  ${fastOutSlowInShort};
`

interface SearchInputProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  className?: string
}

export function SearchInput({ searchQuery, onSearchChange, className }: SearchInputProps) {
  const [inputValue, setInputValue] = useState(searchQuery)
  const [inputFocused, setInputFocused] = useState(false)
  const inputFocusedRef = useValueAsRef(inputFocused)
  const inputRef = useRef<HTMLInputElement>(null)

  const onInputFocus = useCallback(() => {
    setInputFocused(true)
  }, [])
  const onInputBlur = useCallback(() => {
    setInputFocused(false)
  }, [])
  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(event.target.value)
      onSearchChange(event.target.value)
    },
    [onSearchChange],
  )

  useKeyListener({
    onKeyDown: event => {
      if (event.code === F && event.ctrlKey) {
        inputRef.current?.focus()
        inputRef.current?.select()
        return true
      } else if (event.code === ESCAPE && inputFocusedRef.current) {
        inputRef.current?.blur()
        return true
      }

      return false
    },
  })

  return (
    <TextFieldContainer
      clasName={className}
      ref={inputRef}
      value={inputValue}
      label='Search'
      dense={true}
      allowErrors={false}
      isFocused={inputFocused}
      onChange={onInputChange}
      onFocus={onInputFocus}
      onBlur={onInputBlur}
      leadingIcons={[<SearchIcon />]}
    />
  )
}
