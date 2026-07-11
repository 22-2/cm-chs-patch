import type CMJpPatch from "../chsp-main";
import { dblClickPatch } from "./dbl-click";
import { patchKeymap } from "./patch-keymap";

export const getJpPatchExtension = (plugin: CMJpPatch) => [
  dblClickPatch(plugin),
  patchKeymap(plugin),
];
