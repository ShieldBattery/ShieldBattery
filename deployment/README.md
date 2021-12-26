This directory contains all of the files that should be necessary for deplying the various types of
"real" servers we have, minus site-specific configuration. Copy the desired server type directory in
full to the target machine, add a `.env` file containing configuration, add the necessary data files
(e.g. MPQ data) and use `docker-compose up -d` to bring up the server.

For more information see the [deployment guide](../docs/DEPLOYMENT.md).
