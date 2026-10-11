import type { EditorView } from "@codemirror/view";

export function queryPos(
  view: EditorView,
  event: MouseEvent,
): { pos: number; bias: 1 | -1 } {
  const { pos, assoc } = view.posAndSideAtCoords(
    { x: event.clientX, y: event.clientY },
    false,
  );
  return { pos, bias: assoc };
}
