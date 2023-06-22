# email

This directory contains code used to generate HTML/plaintext for our emails. This happens at build
time, with CI to ensure that the generated files are kept up-to-date. Generated templates are sent
to the mailgun API on server start.

When editing emails, you can get a nice preview server using:

```sh
yarn email-dev
```

Unlike with the normal dev server, translations will not be auto-updated, so make sure to run the
translation process as necessary:

```sh
yarn gen-translations
```

- TODO: migrate existing templates
- TODO: Update sending code to utilize templates
- TODO: Ensure fake mailgun server works in integration tests
- TODO: update weblate config to pull these locale files
