import { Plugin } from "obsidian";
import { VimPatcher } from "./chsp-vim.js";
import setupCM6 from "./cm6";
import {
  JpPatchSettingTab,
  DEFAULT_SETTINGS,
  getWordSegmenterLocales,
  VSCODE_WORD_SEPARATORS,
} from "./settings";
import { japanesePatternGlobal, isJapanese } from "./utils.js";
import { WordNavigator } from "./cm6/word-navigation";

// 極端に長い1行（数十万文字のペースト等）への保険としての上限。
// Intl.Segmenter は辞書ベースで前後の文脈から単語境界を決めるため、
// 10文字のような小さい値で切ると境界がズレることがある。
// 実測では2,000文字の分割でも約0.3msなので、この程度なら精度・速度とも問題ない。
const CJK_RANGE_LIMIT = 1000;

// Japanese punctuation characters used as segment boundaries in minimal mode
const japanesePunctuationPattern =
  /[、。！？…「」『』（）［］｛｝〈〉《》【】：；・]/u;

type IntlWordSegment = Intl.SegmentData & { isWordLike: true };

const enum WordCharacterClass {
  Regular,
  Whitespace,
  WordSeparator,
}

// 最小モードは句読点を1文字ずつ扱う従来の分割を維持する。
// カスタムモードは VS Code の走査処理を使い、連続する記号もまとめる。
function separatorCut(
  text: string,
  isSeparator: (char: string) => boolean,
): string[] {
  const result: string[] = [];
  let current = "";
  for (const char of text) {
    if (isSeparator(char) || /\s/.test(char)) {
      if (current) result.push(current);
      result.push(char);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) result.push(current);
  return result;
}

export default class CMJpPatch extends Plugin {
  async onload() {
    this.addSettingTab(new JpPatchSettingTab(this));

    await this.loadSettings();

    if (await this.loadSegmenter()) {
      setupCM6(this);
      console.info("Japanese editor word splitting patched");
    }
    this.addChild(new VimPatcher(this));
  }

  settings = DEFAULT_SETTINGS;

  async loadSettings() {
    const data: unknown = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // 旧バージョンの minimalMode (boolean) から splitMode への移行
    if (
      data &&
      typeof data === "object" &&
      "minimalMode" in data &&
      !("splitMode" in data)
    ) {
      this.settings.splitMode = data.minimalMode ? "minimal" : "segmenter";
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  segmenter?: Intl.Segmenter;
  private segmenterLocalesKey: string | null = null;

  private ensureSegmenter(): Intl.Segmenter | null {
    const locales = getWordSegmenterLocales(this.settings);
    const localesKey = locales?.join(",") ?? "<default>";
    if (this.segmenter && this.segmenterLocalesKey === localesKey) {
      return this.segmenter;
    }
    if (locales && locales.length === 0) {
      // VS Code treats a locale list with no supported tags as disabled
      // segmentation; do not silently turn it into the host default here.
      this.segmenter = undefined;
      this.segmenterLocalesKey = localesKey;
      this.cachedSegmentText = null;
      this.cachedWordSegments = [];
      return null;
    }
    if (!window.Intl?.Segmenter) {
      this.cachedSegmentText = null;
      this.cachedWordSegments = [];
      return null;
    }

    try {
      this.segmenter = new Intl.Segmenter(locales, { granularity: "word" });
    } catch {
      this.segmenter = undefined;
      this.segmenterLocalesKey = null;
      this.cachedSegmentText = null;
      this.cachedWordSegments = [];
      return null;
    }
    this.segmenterLocalesKey = localesKey;
    this.cachedSegmentText = null;
    this.cachedWordSegments = [];
    return this.segmenter;
  }

  async loadSegmenter(): Promise<boolean> {
    // Custom mode can optionally use Intl.Segmenter through WordNavigator,
    // but like minimal mode it still works with separator navigation alone.
    if (this.settings.splitMode !== "segmenter") {
      console.info(
        `${this.settings.splitMode} mode: separator-based splitting`,
      );
      return true;
    }
    if (this.ensureSegmenter()) {
      const locales = getWordSegmenterLocales(this.settings);
      console.info(
        `window.Intl.Segmenter (${locales?.join(", ") ?? "host default"}) loaded`,
      );
      return true;
    }
    console.error("Intl.Segmenter is not available in this environment");
    return false;
  }

  private cachedWordNavigator?: { key: string; value: WordNavigator };
  private readonly vscodeSeparatorSet = new Set(VSCODE_WORD_SEPARATORS);

  // VS Code と同様、直前に処理した1行の word-like セグメントだけを保持する。
  private cachedSegmentText: string | null = null;
  private cachedWordSegments: IntlWordSegment[] = [];

  getWordNavigator(): WordNavigator {
    const wordSegmenterLocales = getWordSegmenterLocales(this.settings);
    const key = JSON.stringify([
      this.settings.wordSeparators,
      wordSegmenterLocales,
    ]);
    // 移動・選択・Vim の分割で直前の行のキャッシュを共有し、
    // 単語境界の設定が変わったときだけ分類器を作り直す。
    if (this.cachedWordNavigator?.key !== key) {
      this.cachedWordNavigator = {
        key,
        value: new WordNavigator({
          wordSeparators: this.settings.wordSeparators,
          wordSegmenterLocales,
        }),
      };
    }
    return this.cachedWordNavigator.value;
  }

  private getIntlWords(text: string): IntlWordSegment[] {
    if (this.cachedSegmentText === text) {
      return this.cachedWordSegments;
    }

    this.cachedSegmentText = text;
    this.cachedWordSegments = [];
    const segmenter = this.ensureSegmenter();
    if (!segmenter) {
      return this.cachedWordSegments;
    }

    for (const segment of segmenter.segment(text)) {
      if (segment.isWordLike) {
        this.cachedWordSegments.push(segment as IntlWordSegment);
      }
    }
    return this.cachedWordSegments;
  }

  private classify(char: string): WordCharacterClass {
    if (/\s/u.test(char)) {
      return WordCharacterClass.Whitespace;
    }
    if (this.vscodeSeparatorSet.has(char)) {
      return WordCharacterClass.WordSeparator;
    }
    return WordCharacterClass.Regular;
  }

  /**
   * Intl.Segmenter の word-like な範囲を通常単語として優先し、範囲外は
   * VS Code の従来方式と同じ文字クラスの連続として分割する。
   * 戻り値は既存のカーソル処理で位置を復元できるよう、入力全体を覆う。
   */
  private vscodeLikeCut(text: string): string[] {
    const words = this.getIntlWords(text);
    const result: string[] = [];
    let offset = 0;
    let wordIndex = 0;

    while (offset < text.length) {
      const word = words[wordIndex];
      if (word?.index === offset) {
        result.push(word.segment);
        offset += word.segment.length;
        wordIndex++;
        continue;
      }

      const nextWordOffset = word?.index ?? text.length;
      const char = String.fromCodePoint(text.codePointAt(offset)!);
      const charClass = this.classify(char);
      let end = offset + char.length;

      while (end < nextWordOffset) {
        const nextChar = String.fromCodePoint(text.codePointAt(end)!);
        if (this.classify(nextChar) !== charClass) {
          break;
        }
        end += nextChar.length;
      }

      result.push(text.slice(offset, end));
      offset = end;
    }

    return result;
  }

  cut(text: string): string[] {
    switch (this.settings.splitMode) {
      case "minimal":
        return separatorCut(text, (char) =>
          japanesePunctuationPattern.test(char),
        );
      case "custom":
        return this.getWordNavigator().splitLine(text);
      default:
        return this.vscodeLikeCut(text);
    }
  }

  getSegRangeFromCursor(
    cursor: number,
    range: { from: number; to: number; text: string },
  ) {
    let { from, to, text } = range;
    if (!isJapanese(text)) {
      return null;
    } else {
      // In segmenter mode, trim long text for performance
      if (this.settings.splitMode === "segmenter") {
        if (cursor - from > CJK_RANGE_LIMIT) {
          const newFrom = cursor - CJK_RANGE_LIMIT;
          // `text` is relative to `from`, whereas cursor/range coordinates are
          // document offsets.  Convert both ends before checking the trimmed
          // context or Intl.Segmenter can receive the wrong substring.
          if (isJapanese(text.slice(newFrom - from, cursor - from))) {
            text = text.slice(newFrom - from);
            from = newFrom;
          }
        }
        if (to - cursor > CJK_RANGE_LIMIT) {
          const newTo = cursor + CJK_RANGE_LIMIT;
          if (isJapanese(text.slice(cursor - from, newTo - from))) {
            // `text` still starts at `from`; use the absolute end relative to
            // that origin so the right-hand trim does not collapse the range.
            text = text.slice(0, newTo - from);
            to = newTo;
          }
        }
      }
      const segResult = this.cut(text);

      if (cursor === to) {
        const lastSeg = segResult.last()!;
        return { from: to - lastSeg.length, to };
      }

      let chunkStart = 0,
        chunkEnd = 0;
      const relativePos = cursor - from;

      for (const seg of segResult) {
        chunkEnd = chunkStart + seg.length;
        if (relativePos >= chunkStart && relativePos < chunkEnd) {
          break;
        }
        chunkStart += seg.length;
      }
      to = chunkEnd + from;
      from += chunkStart;
      return { from, to };
    }
  }

  getSegDestFromGroup(
    startPos: number,
    nextPos: number,
    sliceDoc: (from: number, to: number) => string,
  ): number | null {
    const forward = startPos < nextPos;
    const rawText = forward
      ? sliceDoc(startPos, nextPos)
      : sliceDoc(nextPos, startPos);

    // In minimal/custom mode, don't limit — scan all the way to the next separator
    // In segmenter mode, limit to CJK_RANGE_LIMIT for performance
    const text =
      this.settings.splitMode === "segmenter"
        ? limitJapaneseChars(rawText, forward)
        : rawText;

    if (!isJapanese(text)) return null;
    const segResult = this.cut(text);
    if (segResult.length === 0) return null;

    let length = 0;
    let seg: string;
    do {
      seg = forward ? segResult.shift()! : segResult.pop()!;
      length += seg.length;
    } while (/\s+/.test(seg));

    return forward ? startPos + length : startPos - length;
  }
}

function limitJapaneseChars(input: string, forward: boolean) {
  const s = forward ? input : [...input].reverse().join("");
  let endingIndex = s.length - 1;
  let jpCount = 0;
  for (const { index } of s.matchAll(japanesePatternGlobal)) {
    jpCount++;
    endingIndex = index;
    if (jpCount > CJK_RANGE_LIMIT) break;
  }
  const output = s.slice(0, endingIndex + 1);
  if (!forward) {
    return [...output].reverse().join("");
  }
  return output;
}
