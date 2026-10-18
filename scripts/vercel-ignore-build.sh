#!/bin/sh
# Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds.
# Compares against the last deployed commit (not just HEAD^), so site changes in
# earlier commits of a multi-commit push are never skipped. Builds when unsure.

PATHS="app components lib public scripts models prisma vendor data css.d.ts next.config.mjs package.json package-lock.json tsconfig.json .nvmrc vercel.json"

BASE="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$BASE" ] || ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=50 origin "$VERCEL_GIT_COMMIT_REF" 2>/dev/null
fi
if [ -z "$BASE" ] || ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  echo "No previous deployed commit available - building."
  exit 1
fi

# shellcheck disable=SC2086
if git diff --quiet "$BASE" HEAD -- $PATHS; then
  echo "No site files changed since $BASE - skipping build."
  exit 0
fi
echo "Site files changed since $BASE - building."
exit 1
