import assert from "node:assert/strict";

import {
  WordCharacterClass,
  WordModel,
  WordNavigationType,
  WordNavigator,
  WordCharacterClassifier,
  type WordPosition,
} from "./word-navigation.js";

const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

class TestModel implements WordModel {
  constructor(private readonly lines: readonly string[]) {}

  getLineContent(lineNumber: number): string {
    return this.lines[lineNumber - 1] ?? "";
  }

  getLineMaxColumn(lineNumber: number): number {
    return this.getLineContent(lineNumber).length + 1;
  }

  getLineCount(): number {
    return this.lines.length;
  }
}

function walkRight(
  navigator: WordNavigator,
  model: WordModel,
  position: { lineNumber: number; column: number },
  type = WordNavigationType.WordEnd,
): Array<{ lineNumber: number; column: number }> {
  const result: WordPosition[] = [];
  let current = position;
  for (;;) {
    const next = navigator.moveWordRight(model, current, type);
    if (
      next.lineNumber === current.lineNumber &&
      next.column === current.column
    ) {
      return result;
    }
    result.push(next);
    current = next;
  }
}

function walkWordPartRight(
  navigator: WordNavigator,
  model: WordModel,
  position: WordPosition,
): WordPosition[] {
  const result: WordPosition[] = [];
  let current = position;
  for (;;) {
    const next = navigator.moveWordPartRight(model, current);
    if (
      next.lineNumber === current.lineNumber &&
      next.column === current.column
    ) {
      return result;
    }
    result.push(next);
    current = next;
  }
}

function walkLeft(
  navigator: WordNavigator,
  model: WordModel,
  position: { lineNumber: number; column: number },
  type = WordNavigationType.WordStartFast,
): Array<{ lineNumber: number; column: number }> {
  const result: WordPosition[] = [];
  let current = position;
  for (;;) {
    const next = navigator.moveWordLeft(model, current, type);
    if (
      next.lineNumber === current.lineNumber &&
      next.column === current.column
    ) {
      return result;
    }
    result.push(next);
    current = next;
  }
}

function assertPositions(
  actual: Array<{ lineNumber: number; column: number }>,
  expected: Array<{ lineNumber: number; column: number }>,
): void {
  assert.deepStrictEqual(actual, expected);
}

{
  const classifier = new WordCharacterClassifier(WORD_SEPARATORS);
  assert.equal(classifier.get(0x20), WordCharacterClass.Whitespace);
  assert.equal(classifier.get(0x09), WordCharacterClass.Whitespace);
  assert.equal(
    classifier.get(".".charCodeAt(0)),
    WordCharacterClass.WordSeparator,
  );
  // Newlines are not classified here because the navigator scans one line at
  // a time; line crossing is handled by the movement operation itself.
  assert.equal(classifier.get("\n".charCodeAt(0)), WordCharacterClass.Regular);
  assert.equal(classifier.get("A".charCodeAt(0)), WordCharacterClass.Regular);
}

// These are executable regression cases derived from VS Code's
// wordOperations.test.ts.  They intentionally use columns rather than code
// points, because the editor APIs and the source tests use UTF-16 columns.
{
  const model = new TestModel([
    "   /* Just some   more   text a+= 3 +5-3 + 7 */  ",
  ]);
  const navigator = new WordNavigator({ wordSeparators: WORD_SEPARATORS });
  assertPositions(walkRight(navigator, model, { lineNumber: 1, column: 1 }), [
    { lineNumber: 1, column: 6 },
    { lineNumber: 1, column: 11 },
    { lineNumber: 1, column: 16 },
    { lineNumber: 1, column: 23 },
    { lineNumber: 1, column: 30 },
    { lineNumber: 1, column: 32 },
    { lineNumber: 1, column: 34 },
    { lineNumber: 1, column: 36 },
    { lineNumber: 1, column: 39 },
    { lineNumber: 1, column: 41 },
    { lineNumber: 1, column: 43 },
    { lineNumber: 1, column: 45 },
    { lineNumber: 1, column: 48 },
    { lineNumber: 1, column: 50 },
  ]);
  assertPositions(walkLeft(navigator, model, { lineNumber: 1, column: 50 }), [
    { lineNumber: 1, column: 46 },
    { lineNumber: 1, column: 44 },
    { lineNumber: 1, column: 42 },
    { lineNumber: 1, column: 40 },
    { lineNumber: 1, column: 38 },
    { lineNumber: 1, column: 37 },
    { lineNumber: 1, column: 35 },
    { lineNumber: 1, column: 32 },
    { lineNumber: 1, column: 31 },
    { lineNumber: 1, column: 26 },
    { lineNumber: 1, column: 19 },
    { lineNumber: 1, column: 12 },
    { lineNumber: 1, column: 7 },
    { lineNumber: 1, column: 4 },
    { lineNumber: 1, column: 1 },
  ]);
}

{
  const model = new TestModel(["foo.bar", "next"]);
  const navigator = new WordNavigator({ wordSeparators: WORD_SEPARATORS });
  assertPositions(walkLeft(navigator, model, { lineNumber: 1, column: 8 }), [
    { lineNumber: 1, column: 5 },
    { lineNumber: 1, column: 1 },
  ]);
  assert.deepStrictEqual(
    navigator.moveWordRight(
      model,
      { lineNumber: 1, column: 8 },
      WordNavigationType.WordEnd,
    ),
    { lineNumber: 2, column: 5 },
  );
}

{
  const model = new TestModel(["fooBar_snake-case-HTTP42"]);
  const navigator = new WordNavigator({ wordSeparators: WORD_SEPARATORS });
  assert.deepStrictEqual(
    walkWordPartRight(navigator, model, { lineNumber: 1, column: 1 }),
    [
      { lineNumber: 1, column: 4 },
      { lineNumber: 1, column: 7 },
      { lineNumber: 1, column: 13 },
      { lineNumber: 1, column: 14 },
      { lineNumber: 1, column: 18 },
      { lineNumber: 1, column: 19 },
      { lineNumber: 1, column: 22 },
      { lineNumber: 1, column: 25 },
    ],
  );
  assert.deepStrictEqual(
    walkRight(
      navigator,
      model,
      { lineNumber: 1, column: 1 },
      WordNavigationType.WordStart,
    ),
    [
      { lineNumber: 1, column: 13 },
      { lineNumber: 1, column: 14 },
      { lineNumber: 1, column: 18 },
      { lineNumber: 1, column: 19 },
      { lineNumber: 1, column: 25 },
    ],
  );
  assert.deepStrictEqual(
    navigator.selectWord(model, { lineNumber: 1, column: 14 }),
    {
      from: { lineNumber: 1, column: 14 },
      to: { lineNumber: 1, column: 18 },
    },
  );
}

{
  const model = new TestModel(["これはテストです"]);
  const withoutLocale = new WordNavigator({
    wordSeparators: WORD_SEPARATORS,
    wordSegmenterLocales: [],
  });
  const withJapaneseLocale = new WordNavigator({
    wordSeparators: WORD_SEPARATORS,
    wordSegmenterLocales: ["ja"],
  });
  assert.deepStrictEqual(
    walkRight(withoutLocale, model, { lineNumber: 1, column: 1 }),
    [{ lineNumber: 1, column: 9 }],
  );
  assert.deepStrictEqual(
    walkRight(withJapaneseLocale, model, { lineNumber: 1, column: 1 }),
    [
      { lineNumber: 1, column: 3 },
      { lineNumber: 1, column: 4 },
      { lineNumber: 1, column: 7 },
      { lineNumber: 1, column: 9 },
    ],
  );
  const withChineseLocale = new WordNavigator({
    wordSeparators: WORD_SEPARATORS,
    wordSegmenterLocales: ["zh-CN"],
  });
  assert.deepStrictEqual(
    walkRight(withChineseLocale, new TestModel(["这是中文分词测试"]), {
      lineNumber: 1,
      column: 1,
    }),
    [
      { lineNumber: 1, column: 2 },
      { lineNumber: 1, column: 3 },
      { lineNumber: 1, column: 5 },
      { lineNumber: 1, column: 7 },
      { lineNumber: 1, column: 9 },
    ],
  );
}

{
  const model = new TestModel(["foo  bar", "baz"]);
  const navigator = new WordNavigator({ wordSeparators: WORD_SEPARATORS });
  assert.deepStrictEqual(
    navigator.deleteWordLeft(model, { lineNumber: 1, column: 6 }),
    {
      from: { lineNumber: 1, column: 4 },
      to: { lineNumber: 1, column: 6 },
    },
  );
  assert.deepStrictEqual(
    navigator.deleteWordRight(model, { lineNumber: 1, column: 9 }),
    {
      from: { lineNumber: 1, column: 9 },
      to: { lineNumber: 2, column: 1 },
    },
  );
  assert.deepStrictEqual(
    navigator.deleteWordLeft(model, { lineNumber: 2, column: 1 }),
    {
      from: { lineNumber: 1, column: 9 },
      to: { lineNumber: 2, column: 1 },
    },
  );
}

{
  const model = new TestModel(["a.b"]);
  const navigator = new WordNavigator({ wordSeparators: WORD_SEPARATORS });

  assert.deepStrictEqual(
    walkLeft(
      navigator,
      model,
      { lineNumber: 1, column: 4 },
      WordNavigationType.WordStart,
    ),
    [
      { lineNumber: 1, column: 3 },
      { lineNumber: 1, column: 2 },
      { lineNumber: 1, column: 1 },
    ],
  );
  assert.deepStrictEqual(
    walkLeft(
      navigator,
      model,
      { lineNumber: 1, column: 4 },
      WordNavigationType.WordAccessibility,
    ),
    [
      { lineNumber: 1, column: 3 },
      { lineNumber: 1, column: 1 },
    ],
  );

  // VS Code disables the single-separator fast path for multiple cursors.
  assert.deepStrictEqual(
    navigator.moveWordLeft(
      model,
      { lineNumber: 1, column: 3 },
      WordNavigationType.WordStartFast,
      false,
    ),
    { lineNumber: 1, column: 1 },
  );
  assert.deepStrictEqual(
    navigator.moveWordLeft(
      model,
      { lineNumber: 1, column: 3 },
      WordNavigationType.WordStartFast,
      true,
    ),
    { lineNumber: 1, column: 2 },
  );
  assert.deepStrictEqual(
    walkRight(navigator, model, { lineNumber: 1, column: 1 }),
    [
      { lineNumber: 1, column: 2 },
      { lineNumber: 1, column: 4 },
    ],
  );
  assert.deepStrictEqual(
    navigator.moveWordRight(
      model,
      { lineNumber: 1, column: 1 },
      WordNavigationType.WordAccessibility,
    ),
    { lineNumber: 1, column: 3 },
  );
  const customSeparators = new WordNavigator({ wordSeparators: "" });
  assert.deepStrictEqual(
    customSeparators.moveWordRight(
      model,
      { lineNumber: 1, column: 1 },
      WordNavigationType.WordAccessibility,
    ),
    { lineNumber: 1, column: 3 },
  );
}

{
  // An astral character occupies two UTF-16 code units.  CodeMirror's flat
  // positions and VS Code's columns must therefore report max column 5 here,
  // even though the string contains only three Unicode code points.
  const model = new TestModel(["a🐶b"]);
  const navigator = new WordNavigator({ wordSeparators: WORD_SEPARATORS });
  assert.equal(model.getLineMaxColumn(1), 5);
  assert.deepStrictEqual(
    navigator.moveWordRight(
      model,
      { lineNumber: 1, column: 1 },
      WordNavigationType.WordEnd,
    ),
    { lineNumber: 1, column: 5 },
  );
  assert.deepStrictEqual(
    navigator.moveWordLeft(
      model,
      { lineNumber: 1, column: 5 },
      WordNavigationType.WordStartFast,
    ),
    { lineNumber: 1, column: 1 },
  );
}
