#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REMOTE="${RELEASE_REMOTE:-origin}"
readonly RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
readonly NOTES_FILE="${SCRIPT_DIR}/RELEASE_NOTES.md"

DRY_RUN=false
ASSUME_YES=false
TEMP_INDEX=""

usage() {
  cat <<'USAGE'
Usage: ./release.sh [--dry-run] [--yes]

  --dry-run  Run checks and review the candidate commit without changing Git state or using the network.
  --yes      Skip the interactive release confirmation.
  --help     Show this help text.

Environment overrides:
  RELEASE_REMOTE  Git remote to push (default: origin)
  RELEASE_BRANCH  Release branch (default: main)
USAGE
}

log() {
  printf '[release] %s\n' "$*"
}

fail() {
  printf '[release] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TEMP_INDEX}" && -f "${TEMP_INDEX}" ]]; then
    rm -f -- "${TEMP_INDEX}"
  fi
}

trap cleanup EXIT

for argument in "$@"; do
  case "${argument}" in
    --dry-run) DRY_RUN=true ;;
    --yes) ASSUME_YES=true ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown option: ${argument}"
      ;;
  esac
done

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  command_exists "$1" || fail "Required command is not installed: $1"
}

index_git() {
  if [[ -n "${TEMP_INDEX}" ]]; then
    GIT_INDEX_FILE="${TEMP_INDEX}" git "$@"
  else
    git "$@"
  fi
}

scan_staged_pattern() {
  local label="$1"
  local pattern="$2"
  local matches

  matches="$(index_git grep --cached -IlE -e "${pattern}" -- 2>/dev/null || true)"
  if [[ -n "${matches}" ]]; then
    printf '[release] Possible %s found in staged files:\n%s\n' "${label}" "${matches}" >&2
    fail "Secret scan failed. Remove the credential before releasing."
  fi
}

validate_release_notes() {
  [[ -s "${NOTES_FILE}" ]] || fail "Release notes are missing or empty: ${NOTES_FILE}"

  local first_line
  first_line="$(sed -n '1p' "${NOTES_FILE}")"
  [[ "${first_line}" == "# AtomCLI ${TAG}" ]] || fail "Release notes must start with: # AtomCLI ${TAG}"

  if rg -n 'TODO|TBD' "${NOTES_FILE}" >/dev/null; then
    fail "Release notes still contain TODO or TBD markers."
  fi

  if RELEASE_NOTES_FILE="${NOTES_FILE}" bun -e '
    const text = await Bun.file(process.env.RELEASE_NOTES_FILE).text()
    process.exit(/\p{Extended_Pictographic}/u.test(text) ? 0 : 1)
  '; then
    fail "Release notes contain emoji. Use plain text only."
  fi
}

validate_index() {
  local tracked_ignored
  tracked_ignored="$(index_git ls-files -ci --exclude-standard)"
  if [[ -n "${tracked_ignored}" ]]; then
    printf '[release] Tracked files hidden by ignore rules:\n%s\n' "${tracked_ignored}" >&2
    fail "Tracked/ignored file conflict detected."
  fi

  local forbidden_local
  forbidden_local="$(index_git ls-files | rg '(^|/)\.atomcli/(atomcli\.json(c|\.bak.*)?|mcp\.json|package(-lock)?\.json|bun\.lock|plans?/|runs?/|node_modules/)|(^|/)release_assets/|(^|/)dist/' || true)"
  if [[ -n "${forbidden_local}" ]]; then
    printf '[release] Local or generated files would be committed:\n%s\n' "${forbidden_local}" >&2
    fail "Remove local/generated files from Git tracking before releasing."
  fi

  index_git diff --cached --check

  scan_staged_pattern "private key" '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  scan_staged_pattern "AWS access key" 'AKIA[0-9A-Z]{16}'
  scan_staged_pattern "GitHub token" 'gh[pousr]_[A-Za-z0-9]{20,}'
  scan_staged_pattern "OpenAI-style API key" 'sk-[A-Za-z0-9_-]{20,}'
  scan_staged_pattern "Slack token" 'xox[baprs]-[A-Za-z0-9-]{10,}'
  scan_staged_pattern "Google API key" 'AIza[0-9A-Za-z_-]{30,}'
}

wait_for_release() {
  local commit="$1"
  local run_id=""

  log "Waiting for the GitHub Actions release workflow to start..."
  for _ in $(seq 1 30); do
    run_id="$(gh run list --workflow release.yml --commit "${commit}" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
    [[ -n "${run_id}" ]] && break
    sleep 2
  done

  [[ -n "${run_id}" ]] || fail "The release workflow did not appear within 60 seconds. Check GitHub Actions."

  log "Watching release workflow run ${run_id}..."
  gh run watch "${run_id}" --exit-status

  local release_url
  release_url="$(gh release view "${TAG}" --json url --jq '.url')"
  [[ -n "${release_url}" ]] || fail "Workflow completed but GitHub release ${TAG} was not found."
  log "Release published: ${release_url}"
}

require_command git
require_command bun
require_command rg
if [[ "${DRY_RUN}" == false ]]; then
  require_command gh
fi

cd "${SCRIPT_DIR}"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "This script must run inside the AtomCLI Git repository."
[[ "$(git rev-parse --show-toplevel)" == "${SCRIPT_DIR}" ]] || fail "Repository root does not match the script location."

VERSION="$(bun -e 'console.log(require("./AtomBase/package.json").version)')"
readonly VERSION
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fail "Invalid version in AtomBase/package.json: ${VERSION}"
readonly TAG="v${VERSION}"

validate_release_notes

CURRENT_BRANCH="$(git branch --show-current)"
[[ "${CURRENT_BRANCH}" == "${RELEASE_BRANCH}" ]] || fail "Release must run from ${RELEASE_BRANCH}; current branch is ${CURRENT_BRANCH:-detached HEAD}."

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  fail "Resolve all merge conflicts before releasing."
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  fail "Local tag already exists: ${TAG}"
fi

log "Preparing ${TAG} from ${RELEASE_BRANCH}."
log "Current Bun version: $(bun --version); CI uses the repository-pinned Bun 1.3.10."
git status --short

if [[ "${DRY_RUN}" == false && "${ASSUME_YES}" == false ]]; then
  printf '\nThis will sync %s/%s, validate, commit all non-ignored changes, push the branch, push %s, and wait for the GitHub release.\n' "${REMOTE}" "${RELEASE_BRANCH}" "${TAG}"
  read -r -p "Type ${TAG} to continue: " confirmation
  [[ "${confirmation}" == "${TAG}" ]] || fail "Release cancelled."
fi

if [[ "${DRY_RUN}" == false ]]; then
  gh auth status >/dev/null
  git remote get-url "${REMOTE}" >/dev/null 2>&1 || fail "Git remote does not exist: ${REMOTE}"

  log "Fetching ${REMOTE}/${RELEASE_BRANCH} without unrelated tags..."
  git fetch --no-tags "${REMOTE}" "+refs/heads/${RELEASE_BRANCH}:refs/remotes/${REMOTE}/${RELEASE_BRANCH}"

  if git ls-remote --exit-code --tags "${REMOTE}" "refs/tags/${TAG}" >/dev/null 2>&1; then
    fail "Remote tag already exists: ${TAG}"
  fi

  read -r ahead behind < <(git rev-list --left-right --count "HEAD...${REMOTE}/${RELEASE_BRANCH}")
  if (( ahead > 0 && behind > 0 )); then
    fail "Local and remote branches have diverged. Reconcile them manually before release."
  fi
  if (( behind > 0 )); then
    log "Local branch is behind by ${behind} commit(s); syncing with autostash."
    git pull --rebase --autostash "${REMOTE}" "${RELEASE_BRANCH}"
    [[ -z "$(git diff --name-only --diff-filter=U)" ]] || fail "Sync produced conflicts. Resolve them and rerun the script."
  fi

  SYNCED_VERSION="$(bun -e 'console.log(require("./AtomBase/package.json").version)')"
  [[ "${SYNCED_VERSION}" == "${VERSION}" ]] || fail "Version changed from ${VERSION} to ${SYNCED_VERSION} during sync. Review the branch and rerun."
  validate_release_notes
fi

log "Installing from the locked Bun dependency graph..."
bun install --frozen-lockfile

log "Running workspace typechecks..."
bun turbo typecheck

log "Running workspace tests..."
bun turbo test

if [[ "${DRY_RUN}" == true ]]; then
  TEMP_INDEX="$(mktemp "${TMPDIR:-/tmp}/atomcli-release-index.XXXXXX")"
  cp -- "$(git rev-parse --git-path index)" "${TEMP_INDEX}"
fi

index_git add -A
validate_index

if index_git diff --cached --quiet; then
  log "No commit changes detected; the current HEAD would be tagged."
else
  log "Release commit contents:"
  index_git diff --cached --stat
fi

if [[ "${DRY_RUN}" == true ]]; then
  log "Dry run passed for ${TAG}. No Git state, remote branch, tag, or release was changed."
  exit 0
fi

if ! git diff --cached --quiet; then
  log "Creating release commit..."
  git commit -m "release: ${TAG}"
fi

[[ -z "$(git status --porcelain)" ]] || fail "Working tree changed after the release commit. Review it before pushing."

RELEASE_COMMIT="$(git rev-parse HEAD)"
log "Pushing ${RELEASE_BRANCH} to ${REMOTE}..."
git push "${REMOTE}" "HEAD:${RELEASE_BRANCH}"

log "Creating annotated tag ${TAG}..."
git tag -a "${TAG}" -F "${NOTES_FILE}"
git push "${REMOTE}" "${TAG}"

wait_for_release "${RELEASE_COMMIT}"
