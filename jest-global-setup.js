module.exports = async function () {
  // Ensure consistent timezone in tests
  process.env.TZ = 'UTC'
}
