Folder for redis migrations, that is, whenever the existing stuff that we save in redis needs to
change.

This stuff needs to be run separately from our server. Currently this process is only automated for
Docker deployments, so you'll need to run each migration with `node "@babel/register" FILE` if
you are not using Docker to manage your Redis installation.

Migrations are run every time the server is redeployed, so take care to ensure that they are
idempotent and safe to re-run.
