#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v gh >/dev/null; then
  echo "GitHub CLI (gh) is required: https://cli.github.com/" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "Run: gh auth login -h github.com -w" >&2
  exit 1
fi
if [[ ! -d .git ]]; then
  git init -b main
fi
if ! git config user.name >/dev/null || ! git config user.email >/dev/null; then
  echo "Configure git user.name and user.email before publishing." >&2
  exit 1
fi
if ! git rev-parse HEAD >/dev/null 2>&1; then
  git add .
  git commit -m "Initial You FrashCard Expo/FastAPI app"
fi
if git remote get-url origin >/dev/null 2>&1; then
  echo "Origin already exists: $(git remote get-url origin)"
  git push -u origin HEAD
else
  # Private by default; explicit consent is required before making it public.
  gh repo create service --private --source=. --remote=origin --push
fi

repo_url="$(gh repo view --json url --jq '.url')"
python3 - "$repo_url" <<'PYTHON'
from pathlib import Path
import sys
readme = Path('README.md')
text = readme.read_text()
text = text.replace('`GitHub URL: filled in by scripts/publish-github.sh`', f'[GitHub repository]({sys.argv[1]})')
readme.write_text(text)
PYTHON
if ! git diff --quiet README.md; then
  git add README.md
  git commit -m "Link published repository in README"
  git push origin HEAD
fi
echo "Published: $repo_url"
