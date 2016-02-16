export default function validateNumberRange(min, max, msg) {
  return val => {
    const parsed = parseInt(val, 10)
    return (parsed >= min && parsed <= max) ? null : msg
  }
}
