export type SplitMode = "segmenter" | "minimal" | "custom";

// VS Code の初期値に日本語の記号を足すと通常文字の連続が変わるため、そのまま使う。
export const VSCODE_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";
export const DEFAULT_WORD_SEPARATORS = VSCODE_WORD_SEPARATORS;

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
  splitMode: "segmenter",
  wordSeparators: DEFAULT_WORD_SEPARATORS,
  // 形態素解析モードの日本語分割は維持し、カスタムは VS Code と同じ初期値にする。
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
