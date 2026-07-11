import { PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type CMJpPatch from "./chsp-main";

export interface JpPatchSetting {
  moveByJapaneseWords: boolean;
  moveTillJapanesePunctuation: boolean;
}

export const DEFAULT_SETTINGS: JpPatchSetting = {
  moveByJapaneseWords: true,
  moveTillJapanesePunctuation: true,
};

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

    const segmenterGroup = new SettingGroup(containerEl).setHeading("分かち書き");

    segmenterGroup.addSetting((setting) =>
      setting
        .setName("Intl.Segmenter")
        .setDesc(
          "ブラウザ組み込みの Intl.Segmenter API (ja-JP) を使用して日本語の単語境界を検出します",
        ),
    );

    if (
      this.plugin.app.vault.getConfig("vimMode") === true
    ) {
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
