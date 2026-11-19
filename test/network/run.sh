#!/bin/sh
# Runs the network tests in a container.
#
# The tests create network namespaces and bridges. The container is
# privileged so that it can do that. Everything they create lives inside the
# container and goes away with it.
#
# The modules come from the image. The image build installs them from the
# lockfile. A `node_modules` directory in the checkout is not used.
# The container has no network. It gets the library and the tests read-only.
#
# Usage: test/network/run.sh [mocha arguments]
#
#   CONTAINER_ENGINE  `podman` or `docker`. Default: the first one found.
#   DEBUG             Passed to the tests. `node-ssdp:*` prints library logs.
#   KNOWN_BUGS        Set to 1 to also run the tests for known bugs. They fail.
set -eu

cd "$(dirname "$0")/../.."

engine="${CONTAINER_ENGINE:-}"

if [ -z "$engine" ]; then
  if command -v podman >/dev/null 2>&1; then
    engine=podman
  elif command -v docker >/dev/null 2>&1; then
    engine=docker
  else
    echo "Found neither podman nor docker." >&2
    exit 1
  fi
fi

image=node-ssdp-network-test

"$engine" build --quiet --tag "$image" --file test/network/Containerfile . >/dev/null

exec "$engine" run --rm --privileged --network none --env DEBUG --env KNOWN_BUGS \
  --volume "$PWD/index.js":/work/index.js:ro \
  --volume "$PWD/lib":/work/lib:ro \
  --volume "$PWD/test":/work/test:ro \
  "$image" npm run test:network -- "$@"
