# pixelproof

[![CI](https://github.com/pradeep817/pixelproof/actions/workflows/ci.yml/badge.svg)](https://github.com/pradeep817/pixelproof/actions/workflows/ci.yml)

Design to code for Figma. Flutter screens you can trust: deterministic code, your design tokens, reusable widgets, and a design health check before anything is generated. React Native is next, from the same design tree.

```
Figma file ──► parser ──► design tree + tokens ──► Flutter generator ──► lib/generated/*.g.dart
                  │                                                       test/pixelproof/*_golden_test.dart
                  └──► health check (what to fix in Figma first)
```

## Quick start

```bash
npm install && npm run build
export FIGMA_TOKEN=figd_...        # Figma > Settings > Security > Personal access tokens (File content: read-only)

# 1. Check the design before converting
npx pixelproof check "https://www.figma.com/design/<key>/<name>?node-id=1-2"

# 2. Generate into your Flutter project
npx pixelproof pull "https://www.figma.com/design/<key>/<name>?node-id=1-2" --out ../my_flutter_app
cd ../my_flutter_app && flutter pub add flutter_svg
```

Try it offline with the bundled fixture:

```bash
npx tsx src/cli.ts pull --fixture test/fixtures/login.json --out /tmp/demo_app
```

## What `pull` writes

| File | Contents |
| --- | --- |
| `lib/generated/<screen>.g.dart` | The screen widget plus one widget class per Figma component (`Input`, `ButtonPrimary`...). Texts and swapped icons are constructor parameters; button-like components get `onTap`. |
| `lib/generated/app_tokens.g.dart` | `AppColors` and `AppTextStyles` from your Figma colour and text styles. |
| `assets/icons/*.svg`, `assets/images/*.png` | Icons, vector-only frames and image fills, exported from Figma. |
| `test/pixelproof/<screen>_golden_test.dart` | Renders the screen at the exact Figma frame size for visual comparison. |

Generated files end in `.g.dart`: re-run `pull` to update them, and keep your own logic in separate files that use the generated widgets.

## Conversion rules (why the output matches Figma)

| Figma | Flutter |
| --- | --- |
| Auto layout horizontal / vertical, gap | `Row` / `Column` with `spacing:` (Flutter 3.27+) |
| Hug / Fill / Fixed | `MainAxisSize.min` / `Expanded` or `double.infinity` / fixed size. Fill is only used where the parent is bounded, so layouts never throw unbounded-constraint errors. |
| Absolute position + constraints | `Stack` + `Positioned` (left / right / both), measured from the frame's outer box |
| Line height px | `height: lineHeight / fontSize` with `TextLeadingDistribution.even` |
| Inside / center stroke | `BorderSide.strokeAlign`, and the border width is subtracted from padding (Figma strokes never push content) |
| Drop shadow blur | `blurRadius = (blur / 2 − 0.5) / 0.57735` (matches Figma's blur sigma) |
| Linear / radial gradient | `LinearGradient` / `RadialGradient` from the gradient handles |
| Ellipse | `ShapeDecoration` + `OvalBorder` |
| Colour and text styles | `AppColors.*` / `AppTextStyles.*`, with `copyWith` for overrides |
| Component instances | One widget class per component; overridden instances are inlined rather than breaking the shared class |
| Background blur / layer blur | `ClipRRect` + `BackdropFilter` / `ImageFiltered`, sigma = radius / 2 |
| Straight LINE layers | A bar `Container` in the stroke colour |
| Icons, logos, illustrations (incl. clip-path groups and masks) | One SVG (or PNG if it holds photos); drawn offline from the JSON's vector geometry when there is no API access |
| Free-form screens (no auto layout) | Full-width, equal-margin, centred and right-hand layers keep their anchoring on wider phones |
| Status bar, home indicator | Left out (drawn by the phone); `--keep-system-ui` keeps them |

Not generated yet (listed as comments at the top of the file when present): rotation, inner shadows, angular and diamond gradients, gradient text.

## Health check

`pixelproof check` scores the frame out of 100 and lists fixes, for example:

```
Design health: 97/100  (1 issue)
  ▲ [default-name] Frame 12: "Frame 12" is a default name, so the generated widget gets a generic name.
      fix: Rename it after its purpose, e.g. "Login Button" or "Header".
```

Rules: missing auto layout, overlapping siblings, groups, default layer names, translucent fills, unstyled colours and text, fixed-size text boxes, rotation, detached instances, and repeated layers that should be components.

## Reliability

- Deterministic: the same design always produces byte-identical code (tested).
- Figma API: responses cached by file version in `~/.cache/pixelproof`; HTTP 429 retried with `Retry-After` and backoff; images exported in batches of 50.
- Snapshot test of the full generated file: any change in output must be reviewed (`UPDATE_SNAPSHOTS=1 npm test` to accept).
- Real Flutter in CI: every push generates the fixture screens into a Flutter app, runs `flutter analyze`, and renders each screen, on the oldest supported (3.27) and current stable Flutter. Rendered images are uploaded as build artifacts.
- `pull` checks the target is a Flutter project, registers asset folders in `pubspec.yaml` itself, and prints the exact remaining steps.

## Development

```bash
npm test                                   # unit tests (client screens in test/fixtures/real are optional)
scripts/flutter-check.sh ../pixelproof_demo # generate, analyze and render every fixture in real Flutter
npm run pixelproof -- pull --fixture test/fixtures/login.json --out /tmp/demo
node test/fixtures/make-login.mjs          # rebuild the Login fixture
```

```
src/
  ir.ts                    design tree shared by every input and generator
  figma/types.ts           Figma REST node schema (subset)
  figma/parse.ts           Figma JSON -> design tree, tokens, assets
  figma/client.ts          REST client: link parsing, cache, 429 backoff, image export
  figma/normalize.ts       accepts every Figma JSON shape (API, whole file, plugin export)
  figma/assets.ts          which layers export as one image (icons, logos, illustrations)
  figma/svg.ts             draws icons to SVG from the JSON's vector geometry (no API needed)
  pubspec.ts               comment-preserving pubspec.yaml edits
  health.ts                pre-flight design health check
  gen/flutter/dart.ts      Dart expression builder and formatter
  gen/flutter/emit.ts      design tree -> Flutter widgets + tokens
  gen/flutter/golden.ts    golden test scaffold
  cli.ts                   pixelproof check / pull
```

## Roadmap

1. **Done:** parser, design tree, tokens, health check, Flutter generator, CLI, golden tests, offline icon drawing, Flutter CI.
2. **Next (stability):** `pixelproof doctor`, shared-tokens merging across pulls, fail on missing assets, automatic fonts.
3. **Then (code quality):** auto-extract repeated layers into widgets, split screens into section widgets, `btn_*` / `*input*` layers become real buttons and input fields, infer auto layout on free-form screens.
4. **Then:** verification loop: render the Figma frame via the images API, run the golden test, pixel-diff, report a fidelity score per screen.
5. React Native generator from the same design tree.
6. LLM layer for semantics (component detection, idiomatic widgets) returning structured edits, never raw code.
7. Repo convention learning, MCP server, plugin for Figma.
