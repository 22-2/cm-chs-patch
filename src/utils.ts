const japanesePattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/;
export const japanesePatternGlobal = new RegExp(japanesePattern, "g");
export const isJapanese = (str: string) => {
  return japanesePattern.test(str);
};
