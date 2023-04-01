import React, { useEffect, useImperativeHandle, useRef, useState } from 'react'
import SearchIcon from '../icons/material/search-24px.svg'
import { useKeyListener } from '../keyboard/key-listener'
import { TextField } from '../material/text-field'
import { usePrevious, useStableCallback } from '../state-hooks'
import { useTranslation } from 'react-i18next'

const ESCAPE = 'Escape'
const F = 'KeyF'

export interface SearchInputHandle {
  clear: () => void
}

interface SearchInputProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  className?: string
}

export const SearchInput = React.forwardRef<SearchInputHandle, SearchInputProps>(
  ({ searchQuery, onSearchChange, className }, ref) => {
    const [inputValue, setInputValue] = useState(searchQuery)
    const [searchFocused, setInputFocused] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const { t } = useTranslation()
    const prevSearchQuery = usePrevious(searchQuery)
    useEffect(() => {
      // If we were rendered before and the props have changed, update the input value to match
      if (searchQuery !== prevSearchQuery && prevSearchQuery !== undefined) {
        setInputValue(searchQuery)
      }
    }, [searchQuery, prevSearchQuery])

    useImperativeHandle(ref, () => ({
      clear: () => {
        if (inputValue) {
          setInputValue('')
        }
      },
    }))

    const onInputFocus = useStableCallback(() => {
      setInputFocused(true)
    })
    const onInputBlur = useStableCallback(() => {
      setInputFocused(false)
    })
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
        } else if (event.code === ESCAPE && searchFocused) {
          inputRef.current?.blur()
          return true
        }

        return false
      }),
    })

    return (
      <TextField
        className={className}
        ref={inputRef}
        value={inputValue}
        label={t('common.searchLabel', 'Search')}
        dense={true}
        allowErrors={false}
        onChange={onInputChange}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
        leadingIcons={[<SearchIcon />]}
        hasClearButton={true}
      />
    )
  },
)
