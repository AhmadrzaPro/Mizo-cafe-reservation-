import { fetchAvailability } from "./booking.js";
import { adminDialog, editor } from "./dialogs.js";
import { setMapTools } from "./editor.js";
import { closeImageImport } from "./map-import.js";
import { fetchOperations } from "./operations.js";
import { applyCafeProfile, fetchMap, fetchSettings, syncBranchSelectors } from "./profile.js";
import { store, studioDemo } from "./state.js";

export function exitMapEditor() {
  if (studioDemo) {
    location.href = location.pathname;
    return;
  }
  if (store.dirty && !confirm("تغییرات نقشه هنوز منتشر نشده‌اند. بدون ذخیره بازگردید؟")) return;
  closeImageImport();
  setMapTools(false);
  editor.close();
  adminDialog.showModal();
}
export async function switchBranch(slug, includeOperations = false) {
  if (
    editor.open &&
    store.dirty &&
    slug !== store.currentBranch &&
    !confirm("تغییرات نقشه منتشر نشده‌اند. شعبه را عوض کنید؟")
  ) {
    syncBranchSelectors();
    return false;
  }
  closeImageImport();
  store.currentBranch = slug;
  syncBranchSelectors();
  applyCafeProfile(store.cafeProfile);
  await Promise.all([
    fetchMap(),
    fetchSettings(),
    includeOperations ? fetchOperations() : Promise.resolve(),
  ]);
  await fetchAvailability();
  return true;
}

export function wireEditorNav() {
  document.querySelector("#editorExit").onclick = exitMapEditor;
  document.querySelector("#editorMobileExit").onclick = exitMapEditor;
  document.querySelector("#branchSelect").onchange = (e) => switchBranch(e.target.value);
  document.querySelector("#controlBranch").onchange = (e) => switchBranch(e.target.value);
}
