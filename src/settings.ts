import { PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type CMJpPatch from "./chsp-main";
import {
  DEFAULT_WORD_SEPARATORS,
  type JpPatchSetting,
  type SplitMode,
} from "./word-settings";

export * from "./word-settings";

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
          "Intl.Segmenter: 形態素解析で単語境界を検出。最小: 日本語の句読点と空白のみで分割。カスタム: VS Code と同じ単語境界・Ctrl＋左右の移動規則で分割",
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption("segmenter", "Intl.Segmenter（形態素解析）")
            .addOption("minimal", "最小（句読点のみ）")
            .addOption("custom", "カスタム区切り文字（VS Code）")
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
            "VS Code の editor.wordSeparators と同じ指定です。連続する区切り記号はまとめて扱い、半角スペースとタブは常に空白として扱います",
          )
          .addText((text) =>
            text
              .setPlaceholder(DEFAULT_WORD_SEPARATORS)
              .setValue(this.plugin.settings.wordSeparators)
              .onChange(async (value) => {
                this.plugin.settings.wordSeparators = value;
                await this.plugin.saveSettings();
              }),
          )
          // 保存済みの区切り文字を勝手に変更しないよう、初期値への復帰は明示操作にする。
          .addButton((button) =>
            button.setButtonText("VS Code の初期値に戻す").onClick(async () => {
              this.plugin.settings.wordSeparators = DEFAULT_WORD_SEPARATORS;
              await this.plugin.saveSettings();
              this.display();
            }),
          ),
      );
    }

    if (this.plugin.settings.splitMode !== "minimal") {
      // モード切替だけで日本語の形態素解析が有効にならないよう、ロケールを別々に保存する。
      const localeKey =
        this.plugin.settings.splitMode === "custom"
          ? "customWordSegmenterLocales"
          : "wordSegmenterLocales";
      segmenterGroup.addSetting((setting) =>
        setting
          .setName("wordSegmenterLocales")
          .setDesc(
            this.plugin.settings.splitMode === "custom"
              ? "VS Code の editor.wordSegmenterLocales と同じ指定です。空欄なら形態素解析なし（VS Code の初期値）。日本語も単語単位で分割するなら ja。複数指定はカンマ区切り"
              : "Intl.Segmenter に渡す BCP 47 ロケール。複数指定はカンマ区切り（例: ja-JP, zh-CN）。空欄なら環境の既定ロケール",
          )
          .addText((text) =>
            text
              .setPlaceholder("ja-JP")
              .setValue(this.plugin.settings[localeKey])
              .onChange(async (value) => {
                this.plugin.settings[localeKey] = value;
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
