import { store } from "./state.js";

// Keep the page behind native dialogs completely still, including on iOS.
export function syncModalScrollLock() {
  const hasOpenDialog = Boolean(document.querySelector("dialog[open]"));
  if (hasOpenDialog && !store.modalScrollLocked) {
    store.modalScrollY = window.scrollY;
    document.body.style.top = `-${store.modalScrollY}px`;
    document.body.classList.add("modal-open");
    store.modalScrollLocked = true;
  } else if (!hasOpenDialog && store.modalScrollLocked) {
    document.body.classList.remove("modal-open");
    document.body.style.top = "";
    store.modalScrollLocked = false;
    window.scrollTo(0, store.modalScrollY);
  }
}

export function wireModal() {
  new MutationObserver(syncModalScrollLock).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
}
