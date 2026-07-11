import type { EditorState, SelectionRange } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";

import type CMJpPatch from "../chsp-main";

const cm6GetJpSeg = (
  plugin: CMJpPatch,
  pos: number,
  srcRange: { from: number; to: number } | null,
  state: EditorState,
): SelectionRange | null => {
  if (!srcRange) return null;
  const { from, to } = srcRange,
    text = state.doc.sliceString(from, to);

  const jpSegResult = plugin.getSegRangeFromCursor(pos, { from, to, text });
  if (jpSegResult) {
    return EditorSelection.range(jpSegResult.from, jpSegResult.to);
  } else {
    return null;
  }
};

export default cm6GetJpSeg;
