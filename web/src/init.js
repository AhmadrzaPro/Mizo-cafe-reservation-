import { byId } from "./dom.js";
import { startFloor } from "./floor3d/view.js";
import { applyCafeProfile, fetchSettings, loadCafeProfile } from "./profile.js";

export async function initializeApp() {
  const profile = await loadCafeProfile();
  if (!profile.configured || !profile.branches?.length) {
    // No café to book: the page introduces Mizo to cafés instead.
    document.body.dataset.mode = "platform";
    byId("floorApp").hidden = true;
    return;
  }
  applyCafeProfile(profile);
  // The floor shows at once; the settings (party limit, a paused café) redraw it when they arrive.
  await Promise.all([fetchSettings(), startFloor()]);
}
