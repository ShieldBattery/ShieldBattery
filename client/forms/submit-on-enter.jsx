import React from 'react'
import styled from 'styled-components'

const SubmitOnEnterButton = styled.button`
  position: absolute;
  top: -10000px;
  left: -10000px;
  height: 0px;
  width: 0px;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  visibility: hidden;
`

// Place inside a form to make pressing enter on inputs submit the form
export default () => <SubmitOnEnterButton type='submit' value='Submit' />
