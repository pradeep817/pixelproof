#!/usr/bin/env bash
# Generates screens from Figma JSON into a Flutter app, then checks them with real Flutter:
# `flutter analyze` must find no errors, and every screen must render (golden images).
#
# Usage: scripts/flutter-check.sh <flutter-app-dir> [figma.json ...]
#   With no JSON files given, uses test/fixtures/*.json and test/fixtures/real/*.json.
#   The app is created with `flutter create` if it is missing or incomplete.
# Rendered images: <flutter-app-dir>/test/pixelproof/goldens/*.png
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?usage: scripts/flutter-check.sh <flutter-app-dir> [figma.json ...]}"
shift
FIXTURES=("$@")
if [ ${#FIXTURES[@]} -eq 0 ]; then
  FIXTURES=("$ROOT"/test/fixtures/*.json "$ROOT"/test/fixtures/real/*.json)
fi
# Absolute paths, before we cd into the app.
for i in "${!FIXTURES[@]}"; do
  f="${FIXTURES[$i]}"
  [ -f "$f" ] && FIXTURES[$i]="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
done

echo "== Flutter"
flutter --version | head -1

if [ ! -f "$ROOT/dist/cli.js" ]; then
  echo "== Building pixelproof"
  (cd "$ROOT" && npm run build) || exit 1
fi

if [ ! -f "$APP/pubspec.yaml" ] || [ ! -d "$APP/android" ] || [ ! -d "$APP/ios" ]; then
  # Folder names like "my app" are not valid Dart package names: derive one.
  name="$(basename "$APP" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_]+/_/g; s/^_+|_+$//g; s/^([0-9])/app_\1/')"
  echo "== flutter create $APP (project name: ${name:-app})"
  flutter create "$APP" --project-name "${name:-app}" >/dev/null || exit 1
fi
cd "$APP" || exit 1

# Generate after flutter create: pixelproof registers asset folders in pubspec.yaml
# and writes golden tests with this app's package name.
echo "== Generate screens"
count=0
for f in "${FIXTURES[@]}"; do
  [ -f "$f" ] || continue
  echo "-- $(basename "$f")"
  node "$ROOT/dist/cli.js" pull --fixture "$f" --out . | grep -E "Wrote|Updated pubspec|Assets|⚠" || true
  count=$((count + 1))
done
[ "$count" -gt 0 ] || { echo "No Figma JSON files found."; exit 1; }

grep -q '^  flutter_svg:' pubspec.yaml || flutter pub add flutter_svg
flutter pub get >/dev/null || exit 1

echo "== Analyze"
flutter analyze --no-fatal-infos --no-fatal-warnings lib/generated test/pixelproof
analyze=$?

echo "== Render (golden images)"
flutter test --update-goldens test/pixelproof
render=$?

echo
echo "== Result: $count screen(s); analyze $([ $analyze -eq 0 ] && echo OK || echo FAILED), render $([ $render -eq 0 ] && echo OK || echo FAILED)"
echo "Images: $(pwd)/test/pixelproof/goldens"
[ $analyze -eq 0 ] && [ $render -eq 0 ]
