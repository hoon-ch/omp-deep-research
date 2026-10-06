#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="hoon-ch/omp-deep-research"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
VISIBILITY="--private"
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --public) VISIBILITY="--public" ;;
    --private) VISIBILITY="--private" ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      printf '%s\n' "Usage: bash scripts/publish-github.sh [--private|--public] [--dry-run]" \
        "Creates ${REPOSITORY} and pushes this source tree. Default: PRIVATE." \
        "Requires GitHub CLI already authenticated as hoon-ch. Never prints or accepts tokens." \
        "Refuses existing remote repositories and local Git remotes; never force-pushes."
      exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
if "$DRY_RUN"; then
  printf 'Source: %s\nRepository: %s\nVisibility: %s\n' "$ROOT" "$REPOSITORY" "$VISIBILITY"
  printf '%s\n' "Would verify gh authentication, refuse existing repositories/remotes, initialize Git if needed, commit the project files, and run:" \
    "gh repo create ${REPOSITORY} ${VISIBILITY} --source \"${ROOT}\" --remote origin --push"
  exit 0
fi
for cmd in git gh; do
  command -v "$cmd" >/dev/null 2>&1 || { printf 'Required command not found: %s\n' "$cmd" >&2; exit 1; }
done
[[ -f "$ROOT/package.json" && -f "$ROOT/index.ts" ]] || { echo "Run this script from the original project tree." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "GitHub CLI is not authenticated. Run gh auth login on your own machine." >&2; exit 1; }
LOGIN="$(gh api user --jq .login)"
[[ "$LOGIN" == "hoon-ch" ]] || { printf 'Refusing: authenticated as %s, expected hoon-ch.\n' "$LOGIN" >&2; exit 1; }
if gh repo view "$REPOSITORY" --json nameWithOwner >/dev/null 2>&1; then
  echo "Repository already exists. Refusing to overwrite or modify it automatically: $REPOSITORY" >&2
  exit 1
fi
if [[ ! -e "$ROOT/.git" ]]; then git -C "$ROOT" init -b main; fi
[[ "$(git -C "$ROOT" rev-parse --show-toplevel)" == "$ROOT" ]] || { echo "Git root mismatch; refusing to operate on another repository." >&2; exit 1; }
if [[ -n "$(git -C "$ROOT" remote)" ]]; then
  echo "A local Git remote already exists. Refusing to change its destination." >&2; exit 1
fi
[[ "$(git -C "$ROOT" symbolic-ref --short HEAD)" == "main" ]] || { echo "Expected local branch main. No branch was renamed." >&2; exit 1; }
if ! git -C "$ROOT" diff --cached --quiet; then
  echo "Pre-existing staged changes found. Review or unstage them before publishing; no commit was made." >&2
  exit 1
fi
if ! git -C "$ROOT" var GIT_AUTHOR_IDENT >/dev/null 2>&1; then
  USER_ID="$(gh api user --jq .id)"
  git -C "$ROOT" config --local user.name "$LOGIN"
  git -C "$ROOT" config --local user.email "${USER_ID}+${LOGIN}@users.noreply.github.com"
fi
# Explicit allowlist: never stage node_modules, .env files, local research data, or reports.
git -C "$ROOT" add -- index.ts src tests skills scripts docs .github README.md LICENSE \
  THIRD_PARTY_NOTICES.md CHANGELOG.md SECURITY.md package.json package-lock.json tsconfig.json .gitignore
if ! git -C "$ROOT" diff --cached --quiet; then
  git -C "$ROOT" commit -m "feat: add evidence-driven OMP deep research extension"
fi
if ! git -C "$ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "No commit exists to publish." >&2; exit 1
fi
gh repo create "$REPOSITORY" "$VISIBILITY" \
  --description "Evidence-driven web/data/mixed research for Oh My Pi, inspired by Gajae Code autoresearch" \
  --source "$ROOT" --remote origin --push
printf '\nCreated and pushed: https://github.com/%s\n' "$REPOSITORY"
