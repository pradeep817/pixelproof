import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAssets, hasDependency, packageName } from '../src/pubspec.js';

// The flutter section exactly as `flutter create` writes it (comments included).
const FRESH = `name: my_app
description: "A new Flutter project."
publish_to: 'none'

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8

flutter:

  # The following line ensures that the Material Icons font is
  # included with your application.
  uses-material-design: true

  # To add assets to your application, add an assets section, like this:
  # assets:
  #   - images/a_dot_burr.jpeg

  # fonts:
  #   - family: Schyler
`;

test('pubspec: adds an assets list to a fresh flutter create file, keeping comments', () => {
  const { yaml, added } = addAssets(FRESH, ['assets/icons/', 'assets/images/']);
  assert.deepEqual(added, ['assets/icons/', 'assets/images/']);
  assert.match(yaml, /  uses-material-design: true\n  assets:\n    - assets\/icons\/\n    - assets\/images\/\n/);
  assert.match(yaml, /# To add assets to your application/);
  assert.equal(addAssets(yaml, ['assets/icons/']).added.length, 0, 'second run is a no-op');
});

test('pubspec: appends only missing entries to an existing list, matching its indent', () => {
  const src = `name: a\nflutter:\n    uses-material-design: true\n    assets:\n        - "assets/icons/"\n        - assets/fonts/\nother: 1\n`;
  const { yaml, added } = addAssets(src, ['assets/icons/', 'assets/images/']);
  assert.deepEqual(added, ['assets/images/']);
  assert.match(yaml, /        - assets\/fonts\/\n        - assets\/images\/\nother: 1/);
});

test('pubspec: creates the flutter section when missing; reads name and dependencies', () => {
  const { yaml } = addAssets('name: a\ndependencies:\n  flutter_svg: ^2.0.0\n', ['assets/icons/']);
  assert.match(yaml, /\n\nflutter:\n  uses-material-design: true\n  assets:\n    - assets\/icons\/\n$/);
  assert.equal(packageName(FRESH), 'my_app');
  assert.equal(hasDependency(yaml, 'flutter_svg'), true);
  assert.equal(hasDependency(FRESH, 'flutter_svg'), false);
});
