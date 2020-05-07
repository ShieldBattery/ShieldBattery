This directory contains all of the files that should be necessary for deploying a "real" server,
minus the site-specific configuration. Copy it in full to the target machine, add a `.env` file
containing configuration, add the necessary data files (e.g. MPQ data) and use `docker-compose` to
bring up the server.

For more information see the [deployment guide](../docs/DEPLOYMENT.md).
