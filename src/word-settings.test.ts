import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  DEFAULT_WORD_SEPARATORS,
  VSCODE_WORD_SEPARATORS,
  getWordSegmenterLocales,
} from "./word-settings.js";
import {
  WordNavigator,
  WordNavigationType,
  type WordModel,
} from "./cm6/word-navigation.js";

const customSettings = { ...DEFAULT_SETTINGS, splitMode: "custom" as const };
const createNavigator = (settings = customSettings) =>
  new WordNavigator({
    wordSeparators: settings.wordSeparators,
    wordSegmenterLocales: getWordSegmenterLocales(settings),
  });
const modelFor = (line: string): WordModel => ({
  getLineContent: () => line,
  getLineMaxColumn: () => line.length + 1,
  getLineCount: () => 1,
});

assert.equal(DEFAULT_WORD_SEPARATORS, VSCODE_WORD_SEPARATORS);
assert.deepStrictEqual(getWordSegmenterLocales(customSettings), []);
assert.deepStrictEqual(getWordSegmenterLocales(DEFAULT_SETTINGS), ["ja-JP"]);
assert.deepStrictEqual(
  getWordSegmenterLocales({ ...customSettings, splitMode: "minimal" }),
  [],
);
assert.deepStrictEqual(
  getWordSegmenterLocales({
    ...customSettings,
    customWordSegmenterLocales: " ja, invalid_tag, zh-CN, zz-ZZ ",
  }),
  ["ja", "zh-CN"],
);

const navigator = createNavigator();
// VS Code groups punctuation runs and only treats ASCII space/tab as
// whitespace. Japanese punctuation and Unicode spaces stay regular by default.
for (const [text, expected] of [
  ["foo...bar", ["foo", "...", "bar"]],
  [" foo \t bar ", [" ", "foo", " \t ", "bar", " "]],
  ["日本語、句読点。", ["日本語、句読点。"]],
  ["foo\u3000bar\u00a0baz", ["foo\u3000bar\u00a0baz"]],
  ["foo_barBaz", ["foo_barBaz"]],
  ["a🐶b", ["a🐶b"]],
  ["...", ["..."]],
  [" \t ", [" \t "]],
  ["", []],
] as const) {
  const tokens = navigator.splitLine(text);
  assert.deepStrictEqual(tokens, expected);
  assert.equal(tokens.join(""), text);
}

const model = modelFor("foo...bar.baz");
assert.deepStrictEqual(
  [1, 4, 7, 10].map((column) =>
    navigator.moveWordRight(
      model,
      { lineNumber: 1, column },
      WordNavigationType.WordEnd,
    ),
  ),
  [4, 7, 10, 14].map((column) => ({ lineNumber: 1, column })),
);
assert.deepStrictEqual(
  [14, 11, 10, 7, 4].map((column) =>
    navigator.moveWordLeft(
      model,
      { lineNumber: 1, column },
      WordNavigationType.WordStartFast,
    ),
  ),
  [11, 7, 7, 4, 1].map((column) => ({ lineNumber: 1, column })),
);
assert.deepStrictEqual(
  navigator.getWordAtPosition(modelFor("日本語、句読点。"), {
    lineNumber: 1,
    column: 5,
  }),
  {
    from: { lineNumber: 1, column: 1 },
    to: { lineNumber: 1, column: 9 },
  },
);
assert.equal(
  navigator.getWordAtPosition(model, { lineNumber: 1, column: 6 }),
  null,
);
// Lookup at a word's end prefers the left word, unlike separator selection.
assert.deepStrictEqual(
  navigator.getWordAtPosition(model, { lineNumber: 1, column: 4 }),
  {
    from: { lineNumber: 1, column: 1 },
    to: { lineNumber: 1, column: 4 },
  },
);

const japaneseNavigator = createNavigator({
  ...customSettings,
  customWordSegmenterLocales: "ja",
});
assert.deepStrictEqual(japaneseNavigator.splitLine("これはテストです"), [
  "これ",
  "は",
  "テスト",
  "です",
]);
assert.deepStrictEqual(
  createNavigator({ ...customSettings, wordSeparators: "、。" }).splitLine(
    "日本語、、句読点。",
  ),
  ["日本語", "、、", "句読点", "。"],
);
assert.deepStrictEqual(
  createNavigator({ ...customSettings, wordSeparators: "" }).splitLine(
    "foo...bar",
  ),
  ["foo...bar"],
);
