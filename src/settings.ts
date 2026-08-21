import { PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type CMJpPatch from "./chsp-main";

export type SplitMode = "segmenter" | "minimal" | "custom";

// VS Code の editor.wordSeparators 標準値。
export const VSCODE_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

// VS Code の標準値 + 最小モードで使っている日本語句読点。
// custom モードの初期値として「VSCode と同じ書き方」で編集できるようにする
export const DEFAULT_WORD_SEPARATORS = `${VSCODE_WORD_SEPARATORS}、。！？…「」『』（）［］｛｝〈〉《》【】：；・`;

export interface JpPatchSetting {
  splitMode: SplitMode;
  wordSeparators: string;
  /** Comma-separated BCP 47 locales used by Intl.Segmenter. */
  wordSegmenterLocales: string;
  moveByJapaneseWords: boolean;
  moveTillJapanesePunctuation: boolean;
}

export const DEFAULT_SETTINGS: JpPatchSetting = {
  splitMode: "segmenter",
  wordSeparators: DEFAULT_WORD_SEPARATORS,
  // The project exists to provide Japanese/CJK splitting, while VS Code's
  // own editor option defaults to no explicit locale.  Keep the project
  // default stable and make the locale override visible in settings.
  wordSegmenterLocales: "ja-JP",
  moveByJapaneseWords: true,
  moveTillJapanesePunctuation: true,
};

export function getWordSegmenterLocales(
  settings: JpPatchSetting,
): string[] | undefined {
  if (settings.splitMode !== "segmenter") return [];
  const locales = settings.wordSegmenterLocales
    .split(",")
    .map((locale) => locale.trim())
    .filter(Boolean);
  // `undefined` asks Intl.Segmenter to use the host default locale.  An empty
  // array means that no usable locale survived validation (or segmentation is
  // disabled by the caller).
  if (locales.length === 0) return undefined;
  if (typeof Intl === "undefined" || !Intl.Segmenter) return locales;
  try {
    // Match VS Code's editor option validation: unsupported BCP 47 tags are
    // ignored individually instead of making one valid locale unusable.
    return Intl.Segmenter.supportedLocalesOf(locales);
  } catch {
    return [];
  }
}

type SettingKeyWithType<T> = {
  [K in keyof JpPatchSetting]: JpPatchSetting[K] extends T ? K : never;
}[keyof JpPatchSetting];

export class JpPatchSettingTab extends PluginSettingTab {
  private displayVersion = 0;

  constructor(public plugin: CMJpPatch) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const displayVersion = ++this.displayVersion;

    containerEl.empty();

    const segmenterGroup = new SettingGroup(containerEl).setHeading(
      "分かち書き",
    );

    segmenterGroup.addSetting((setting) =>
      setting
        .setName("分割方式")
        .setDesc(
          "Intl.Segmenter: ブラウザ組み込みの形態素解析 (ja-JP) で単語境界を検出。最小: 日本語の句読点と空白のみで分割。カスタム: 自分で定義した区切り文字で分割",
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption("segmenter", "Intl.Segmenter（形態素解析）")
            .addOption("minimal", "最小（句読点のみ）")
            .addOption("custom", "カスタム区切り文字")
            .setValue(this.plugin.settings.splitMode)
            .onChange(async (value) => {
              this.plugin.settings.splitMode = value as SplitMode;
              await this.plugin.loadSegmenter();
              await this.plugin.saveSettings();
              // custom 選択時のみ区切り文字入力欄を出すため再描画する
              this.display();
            }),
        ),
    );

    if (this.plugin.settings.splitMode === "custom") {
      segmenterGroup.addSetting((setting) =>
        setting
          .setName("区切り文字")
          .setDesc(
            "ここに列挙した文字を単語の区切りとして扱います。空白は常に区切りです",
          )
          .addText((text) =>
            text
              .setPlaceholder(DEFAULT_WORD_SEPARATORS)
              .setValue(this.plugin.settings.wordSeparators)
              .onChange(async (value) => {
                this.plugin.settings.wordSeparators = value;
                await this.plugin.saveSettings();
              }),
          ),
      );
    }

    if (this.plugin.settings.splitMode === "segmenter") {
      segmenterGroup.addSetting((setting) =>
        setting
          .setName("wordSegmenterLocales")
          .setDesc(
            "Intl.Segmenter に渡す BCP 47 ロケール。複数指定はカンマ区切り（例: ja-JP, zh-CN）。空欄なら環境の既定ロケール",
          )
          .addText((text) =>
            text
              .setPlaceholder("ja-JP")
              .setValue(this.plugin.settings.wordSegmenterLocales)
              .onChange(async (value) => {
                this.plugin.settings.wordSegmenterLocales = value;
                await this.plugin.loadSegmenter();
                await this.plugin.saveSettings();
              }),
          ),
      );
    }

    if (this.plugin.app.vault.getConfig("vimMode") === true) {
      const vimGroup = new SettingGroup(containerEl).setHeading("Vim Mode");

      vimGroup.addSetting((setting) =>
        this.bindToggle(setting, "moveByJapaneseWords")
          .setName("単語単位でカーソル移動")
          .setDesc(
            "Motion w/e/b/ge で日本語の単語単位でカーソル移動（Vim Normal Mode、Obsidian 再起動後に反映）",
          ),
      );

      vimGroup.addSetting((setting) =>
        this.bindToggle(setting, "moveTillJapanesePunctuation")
          .setName("f/t<character> で英字記号を日本語の記号にマッピング")
          .setDesc(
            "Motion f/t<character> で英字記号入力時に日本語の記号へジャンプ（Vim Normal Mode、Obsidian 再起動後に反映）",
          ),
      );
    }
  }

  private bindToggle(
    setting: Setting,
    key: SettingKeyWithType<boolean>,
  ): Setting {
    return setting.addToggle((toggle) => {
      toggle.setValue(this.plugin.settings[key]).onChange((value) => {
        this.plugin.settings[key] = value;
        this.plugin.saveSettings();
      });
    });
  }
}
