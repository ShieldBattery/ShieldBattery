export default function () {
  // Ensure consistent timezone in tests
  process.env.TZ = 'UTC'
}
