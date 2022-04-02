import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import SearchIcon from '../icons/material/baseline-search-24px.svg'
import { useKeyListener } from '../keyboard/key-listener'
import { fastOutSlowInShort } from '../material/curves'
import TextField from '../material/text-field'
import { useValueAsRef } from '../state-hooks'

const ESCAPE = 'Escape'
const F = 'KeyF'

const TextFieldContainer = styled(TextField)`
  width: ${props => (props.isFocused ? '250px' : '200px')};
  ${fastOutSlowInShort};
`

interface SearchInputProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  className?: string
}

export function SearchInput({ searchQuery, onSearchChange, className }: SearchInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const inputFocusedRef = useValueAsRef(inputFocused)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // In case the `searchQuery` (the value that was actually searched for) gets out of sync with
    // the input value (which can happen if network requests return out of order for example), we
    // update the input value to what was actually searched for so it reflects the search results
    // accurately.
    setInputValue(searchQuery)
  }, [searchQuery])

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
