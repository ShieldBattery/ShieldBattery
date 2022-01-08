import styled from 'styled-components'

/** Place inside a form to make pressing enter on inputs submit the form. */
export const SubmitOnEnter = styled.button.attrs({ type: 'submit', value: 'Submit' })`
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

export default SubmitOnEnter
