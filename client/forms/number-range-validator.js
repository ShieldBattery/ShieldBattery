function validateNumberRange(min, max, msg) {
  return val => parseInt(val, 10) >= min && parseInt(val, 10) <= max ? null : msg
}

export default validateNumberRange
