#!/usr/bin/env bash
# Run the schema + permission tests in a throwaway Postgres container.
# Usage: bash supabase/tests/run.sh   (needs Docker; removes the container afterwards)
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=pmex-gym-test-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
sleep 1
psql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql < tests/auth_stub.sql
psql < migrations/20260929000000_gym_manager.sql
psql -t -A < tests/rls_test.sql
