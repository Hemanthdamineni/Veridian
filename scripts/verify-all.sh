#!/usr/bin/env bash
#
# Run every check this repository has, in one command.
#
# This is the command to run before you call something finished. It is what
# CI runs, plus the checks that need a populated database.
#
#   ./scripts/verify-all.sh
#
# It exits non-zero on the first failure, and prints what failed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

WEB="$ROOT/veridian-web"
PYTHON="${PYTHON:-$ROOT/.venv/bin/python}"
FAILED=()

step() {
  local name="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$name"
  if "$@"; then
    printf '\033[32m   ok\033[0m\n'
  else
    printf '\033[31m   FAILED\033[0m\n'
    FAILED+=("$name")
  fi
}

# --- Static checks ----------------------------------------------------------
step "lint (web)"            bash -c "cd '$WEB' && npm run lint"
step "typecheck (web)"       bash -c "cd '$WEB' && npm run typecheck"

# --- Tests ------------------------------------------------------------------
step "tests (web)"           bash -c "cd '$WEB' && npm test"
step "tests (python)"        bash -c "cd '$ROOT' && '$PYTHON' -m pytest -q"

# --- Build ------------------------------------------------------------------
step "production build"      bash -c "cd '$WEB' && npm run build"

# --- Schema -----------------------------------------------------------------
step "postgres schema drift" bash -c "cd '$WEB' && npm run db:schema:pg-check"

# --- Data -------------------------------------------------------------------
# These need a populated database. If the database is empty the audit and the
# assertions will say so rather than pass silently, which is what we want.
step "catalog audit"         bash -c "cd '$WEB' && npm run db:audit"
step "catalog assertions"    bash -c "cd '$WEB' && npm run db:assert"
step "public API smoke"      bash -c "cd '$WEB' && npm run db:api:smoke"

printf '\n'
if [ ${#FAILED[@]} -ne 0 ]; then
  printf '\033[31m%d check(s) failed:\033[0m\n' "${#FAILED[@]}"
  for name in "${FAILED[@]}"; do printf '  - %s\n' "$name"; done
  exit 1
fi

printf '\033[32mEvery check passed.\033[0m\n'
