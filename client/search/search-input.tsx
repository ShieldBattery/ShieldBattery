import React, { useState } from 'react'
import styled from 'styled-components'
import SearchIcon from '../icons/material/baseline-search-24px.svg'
import { useKeyListener } from '../keyboard/key-listener'
import { fastOutSlowInShort } from '../material/curves'
import { TextField, TextFieldHandle } from '../material/text-field'
import { useMultiRef, useStableCallback } from '../state-hooks'

const ESCAPE = 'Escape'
const F = 'KeyF'

const TextFieldContainer = styled(TextField)`
  width: var(--sb-search-input-width, 200px);
  ${fastOutSlowInShort};

  &:focus-within {
    width: var(--sb-search-input-focused-width, 256px);
  }
`

interface SearchInputProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  isSearching?: boolean
  className?: string
}

export const SearchInput = React.forwardRef<TextFieldHandle, SearchInputProps>(
  ({ searchQuery, onSearchChange, isSearching, className }, ref) => {
    const [inputValue, setInputValue] = useState(searchQuery)
    const [inputRef, setInputRef] = useMultiRef<TextFieldHandle>(ref)

    const onInputChange = useStableCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(event.target.value)
      onSearchChange(event.target.value)
    })

    useKeyListener({
      onKeyDown: useStableCallback(event => {
        if (event.code === F && event.ctrlKey) {
          inputRef.current?.focus()
          inputRef.current?.select()
          return true
        } else if (event.code === ESCAPE) {
          inputRef.current?.blur()
          return true
        }

        return false
      }),
    })

    return (
      <TextFieldContainer
        className={className}
        ref={setInputRef}
        value={inputValue}
        label='Search'
        dense={true}
        allowErrors={false}
        onChange={onInputChange}
        leadingIcons={[<SearchIcon />]}
        hasClearButton={true}
      />
    )
  },
)
