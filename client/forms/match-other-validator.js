function validateMatchesOther(otherName, msg) {
  return (val, form) => val === form.getValueOf(otherName) ? null : msg
}

export default validateMatchesOther
