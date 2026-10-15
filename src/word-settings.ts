export type SplitMode = "segmenter" | "minimal" | "custom";

// 形態素解析モードは記号の連続を VS Code の初期値で判定するため、別に残す。
export const VSCODE_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";
// VS Code の editor.wordSeparators に日本語の記号と助詞を足した初期値。
// 形態素解析を使わず、句読点・括弧・助詞（てにをは）の位置で区切る。
export const DEFAULT_WORD_SEPARATORS =
  "/\\()\"':,.;<>~!@#$%^&*|+=[]{}`?-、。「」【】『』（）！？＝・／　：てにをは";

export interface JpPatchSetting {
  splitMode: SplitMode;
  wordSeparators: string;
  /** Intl.Segmenter に渡す BCP 47 ロケール（カンマ区切り）。 */
  wordSegmenterLocales: string;
  /** VS Code の初期値を維持するため、形態素解析モードと独立して保存する。 */
  customWordSegmenterLocales: string;
  moveByJapaneseWords: boolean;
  moveTillJapanesePunctuation: boolean;
}

export const DEFAULT_SETTINGS: JpPatchSetting = {
  splitMode: "custom",
  wordSeparators: DEFAULT_WORD_SEPARATORS,
  // 形態素解析モードへ切り替えたときは日本語で分割し、カスタムは形態素解析なしにする。
  wordSegmenterLocales: "ja-JP",
  customWordSegmenterLocales: "",
  moveByJapaneseWords: true,
  moveTillJapanesePunctuation: true,
};

export function getWordSegmenterLocales(
  settings: JpPatchSetting,
): string[] | undefined {
  if (settings.splitMode === "minimal") return [];
  const source =
    settings.splitMode === "custom"
      ? settings.customWordSegmenterLocales
      : settings.wordSegmenterLocales;
  const locales = source
    .split(",")
    .map((locale) => locale.trim())
    .filter(Boolean);
  // VS Code はロケールが空なら形態素解析を無効にする。
  // 形態素解析モードだけは従来どおり環境の既定ロケールを要求する。
  if (locales.length === 0) {
    return settings.splitMode === "custom" ? [] : undefined;
  }
  if (typeof Intl === "undefined" || !Intl.Segmenter) return locales;
  // VS Code と同じく個別に検証し、不正なタグが混ざっても ja 等の有効な指定を残す。
  return locales.filter((locale) => {
    try {
      return Intl.Segmenter.supportedLocalesOf(locale).length > 0;
    } catch {
      return false;
    }
  });
}
