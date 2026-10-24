# Integration tests

These will run automatically via GitHub actions. If you'd like to run them locally, see
[this guide](https://github.com/ShieldBattery/ShieldBattery/blob/master/docs/GETTING_STARTED.md#running-integration-tests-locally).

The test app server runs in production mode without client release keys. Its Compose configuration
sets `SB_ALLOW_UNSIGNED_SIGNUP=true` so setup and browser tests can create accounts.
