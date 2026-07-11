import { Plugin } from "obsidian";
import { VimPatcher } from "./chsp-vim.js";
import setupCM6 from "./cm6";
import { JpPatchSettingTab, DEFAULT_SETTINGS } from "./settings";
import { japanesePatternGlobal, isJapanese } from "./utils.js";

const CJK_RANGE_LIMIT = 10;

// Japanese punctuation characters used as segment boundaries in minimal mode
const japanesePunctuationPattern = /[、。！？…「」『』（）［］｛｝〈〉《》【】：；・]/u;

function minimalCut(text: string): string[] {
  const result: string[] = [];
  let current = "";
  for (const char of text) {
    if (japanesePunctuationPattern.test(char) || /\s/.test(char)) {
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  segmenter?: Intl.Segmenter;

  async loadSegmenter(): Promise<boolean> {
    // minimal mode doesn't need Intl.Segmenter
    if (this.settings.minimalMode) {
      console.info("Minimal mode: using punctuation-based splitting");
      return true;
    }
    if (window.Intl?.Segmenter) {
      this.segmenter = new Intl.Segmenter("ja-JP", {
        granularity: "word",
      });
      console.info("window.Intl.Segmenter (ja-JP) loaded");
      return true;
    }
    console.error("Intl.Segmenter is not available in this environment");
    return false;
  }

  cut(text: string): string[] {
    if (this.settings.minimalMode) {
      return minimalCut(text);
    }
    return Array.from(this.segmenter!.segment(text)).map((seg) => seg.segment);
  }

  getSegRangeFromCursor(
    cursor: number,
    range: { from: number; to: number; text: string },
  ) {
    let { from, to, text } = range;
    if (!isJapanese(text)) {
      return null;
    } else {
      // In full mode, trim long text for performance
      if (!this.settings.minimalMode) {
        if (cursor - from > CJK_RANGE_LIMIT) {
          const newFrom = cursor - CJK_RANGE_LIMIT;
          if (isJapanese(text.slice(newFrom, cursor))) {
            text = text.slice(newFrom - from);
            from = newFrom;
          }
        }
        if (to - cursor > CJK_RANGE_LIMIT) {
          const newTo = cursor + CJK_RANGE_LIMIT;
          if (isJapanese(text.slice(cursor, newTo))) {
            text = text.slice(0, newTo - to);
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

    // In minimal mode, don't limit — scan all the way to the next punctuation
    // In full mode, limit to CJK_RANGE_LIMIT for performance
    const text = this.settings.minimalMode
      ? rawText
      : limitJapaneseChars(rawText, forward);

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
