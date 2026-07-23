#!/bin/zsh

# Build the clean cross-platform source archive used for GitHub Releases.

set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
DIST_DIR="$PROJECT_DIR/dist"
PACKAGE_NAME="AI-Interview-Simulator"
STAGING_DIR="$DIST_DIR/$PACKAGE_NAME"
ARCHIVE="$DIST_DIR/$PACKAGE_NAME-GitHub.zip"

rm -rf "$STAGING_DIR" "$ARCHIVE" "$ARCHIVE.sha256"
mkdir -p "$STAGING_DIR"

copy_item() {
  /usr/bin/rsync -a \
    --exclude '.DS_Store' \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    "$PROJECT_DIR/$1" "$STAGING_DIR/"
}

for item in \
  .env.example \
  .gitignore \
  README.md \
  package.json \
  "Start AI Interview Simulator.command" \
  "Start AI Interview Simulator.bat" \
  "AI Interview Simulator.app" \
  backend \
  director \
  reporting \
  tests; do
  copy_item "$item"
done

mkdir -p "$STAGING_DIR/frontend/public" "$STAGING_DIR/docs" "$STAGING_DIR/scripts"
/usr/bin/rsync -a \
  --prune-empty-dirs \
  --exclude '.next/' \
  --exclude 'node_modules/' \
  --exclude 'video-references/' \
  --exclude '.DS_Store' \
  "$PROJECT_DIR/frontend/" "$STAGING_DIR/frontend/"

for item in \
  01_PRODUCT_REQUIREMENTS.md \
  02_TECH_ARCHITECTURE.md \
  04_DIRECTOR_ENGINE.md \
  06_UI_UX_GUIDELINES.md \
  09_TESTING.md \
  audit-screenshots; do
  /usr/bin/rsync -a "$PROJECT_DIR/docs/$item" "$STAGING_DIR/docs/"
done

/usr/bin/rsync -a "$PROJECT_DIR/scripts/README.md" "$PROJECT_DIR/scripts/verify_google_live.py" "$PROJECT_DIR/scripts/launcher_revision.py" "$PROJECT_DIR/scripts/build-release.sh" "$STAGING_DIR/scripts/"
/usr/bin/find "$STAGING_DIR" -name '.DS_Store' -delete
/bin/chmod +x "$STAGING_DIR/Start AI Interview Simulator.command" "$STAGING_DIR/AI Interview Simulator.app/Contents/MacOS/launcher"
/usr/bin/perl -pi -e 's/\r?\n/\r\n/g' "$STAGING_DIR/Start AI Interview Simulator.bat"

cd "$DIST_DIR"
/usr/bin/zip -qry "$ARCHIVE" "$PACKAGE_NAME"
/usr/bin/shasum -a 256 "${ARCHIVE:t}" > "${ARCHIVE:t}.sha256"

print "Created: $ARCHIVE"
print "Checksum: $ARCHIVE.sha256"
