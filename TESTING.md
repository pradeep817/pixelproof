# Testing pixelproof

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 20 or newer | `node -v` |
| Flutter | 3.27 or newer (generated code uses `Row`/`Column` `spacing:`) | `flutter --version` |

## 1. Unit tests (no Flutter needed)

```bash
npm install
npm run build
npm test
```

Tests under "real:" use client screens in `test/fixtures/real/`, which are not committed. They skip when the files are absent.

## 2. Check the generated code in real Flutter (one command)

```bash
scripts/flutter-check.sh ../pixelproof_demo
```

It creates the Flutter app if needed, generates every screen in `test/fixtures/` (and `test/fixtures/real/` if present), registers the assets, adds `flutter_svg`, then:

- runs `flutter analyze` on the generated code: must report no errors;
- renders each screen at its Figma size (golden tests): must not throw (missing asset, layout overflow, etc.).

Rendered images land in `../pixelproof_demo/test/pixelproof/goldens/`. Compare them with the Figma frames.

Check specific files instead of the fixtures:

```bash
scripts/flutter-check.sh ../pixelproof_demo path/to/screen_a.json path/to/screen_b.json
```

CI runs the same script on every push, on Flutter 3.27.0 and 3.38.1, and uploads the images as build artifacts.

To see screens live, put one in `lib/main.dart` (`home: const LoginScreen()`, importing `generated/login.g.dart`) and `flutter run`.

## 3. Your own Figma design (live API)

1. **Token:** Figma > Settings > Security > Personal access tokens > Generate new token. Scope: File content, read-only.
2. **Set it** in your shell (never commit it):
   - macOS / Linux: `export FIGMA_TOKEN=figd_xxx`
   - Windows PowerShell: `$env:FIGMA_TOKEN="figd_xxx"`
3. **Link:** in Figma, right-click a screen frame > Copy link to selection. It must contain `node-id=`.
4. **Check and generate:**
   ```bash
   node dist/cli.js check "PASTE_LINK"
   node dist/cli.js pull "PASTE_LINK" --out ../pixelproof_demo
   ```
   Real icons and photos are downloaded, and asset folders are added to `pubspec.yaml`. Follow the **Next** list it prints.

## Options

| Option | Effect |
| --- | --- |
| `--fixture <file>` | Use a saved Figma JSON export instead of the API |
| `--fixed-width` | Keep the Figma width instead of filling the device |
| `--no-scroll` | Do not wrap the screen in a scroll view |
| `--no-assets` | Skip downloading; icons are drawn from the JSON or get placeholders |
| `--keep-system-ui` | Keep status bar / home indicator layers |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `The named parameter 'spacing' isn't defined` | Flutter older than 3.27. Run `flutter upgrade`. |
| `Unable to load asset: assets/...` | Asset folder missing from `pubspec.yaml` (`flutter create .` can reset it). Re-run `pull` or the check script; it re-adds them. Restart the app after pubspec changes. |
| `has no pubspec.yaml` | The folder is not a complete Flutter project. Run `flutter create .` in it, then pull again. |
| `Target of URI doesn't exist: package:flutter_svg` | `flutter pub add flutter_svg`. |
| `pixelproof: Figma refused access (403)` | Token wrong or expired, or your account can't open the file. |
| `pixelproof: The link has no node-id` | Copy the link from a selected frame, not the file. |
| `Figma rate limit hit; waiting...` | Normal on heavy use; it waits and retries. Unchanged files are cached. |
| Text looks slightly different | The design font isn't installed. Put the font files in `assets/fonts/` and register them in `pubspec.yaml`. |

Set `PIXELPROOF_DEBUG=1` for full error details.
