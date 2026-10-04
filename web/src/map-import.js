import { apiUrl } from "./api.js";
import { renderEditor, setMapTools, showPublishedToast, tableSize } from "./editor.js";
import { areaBounds } from "./floor/zoom.js";
import { faDigits } from "./format.js";
import { markDirty } from "./profile.js";
import { store } from "./state.js";

export function activeTables() {
  return store.cafeMap.tables.filter((t) => t.area === store.activeArea);
}
export function resetImageImport() {
  store.mapImageRequest++;
  store.mapImageData = "";
  store.mapImageDraft = [];
  document.querySelector("#mapImageFile").value = "";
  document.querySelector("#imageImportPreview").hidden = true;
  document.querySelector("#imageImportPreview").classList.remove("marking");
  document.querySelector("#importMarkers").innerHTML = "";
  document.querySelector("#analyzeMapImage").disabled = true;
  document.querySelector("#markMapImage").disabled = true;
  document.querySelector("#markMapImage").classList.remove("active");
  document.querySelector("#applyMapImage").disabled = true;
  document.querySelector("#imageImportStatus").textContent = "تصویر را انتخاب کنید.";
}
export function renderImageMarkers() {
  const layer = document.querySelector("#importMarkers");
  layer.innerHTML = "";
  store.mapImageDraft.forEach((t, i) => {
    const label = document.createElement("label");
    label.className = "import-marker";
    label.style.left = `${t.x}%`;
    label.style.top = `${t.y}%`;
    label.innerHTML = `<input type="checkbox" ${t.confidence === "low" ? "" : "checked"} aria-label="افزودن میز ${faDigits(i + 1)}"><span>${faDigits(i + 1)}</span>`;
    label.onclick = (event) => event.stopPropagation();
    layer.appendChild(label);
  });
  document.querySelector("#applyMapImage").disabled = !store.mapImageDraft.length;
}
export function closeImageImport() {
  document.querySelector("#imageImportPanel").hidden = true;
  resetImageImport();
}

export function wireMapImport() {
  document.querySelector("#openImageImport").onclick = async () => {
    setMapTools(false);
    store.mapImageArea = store.activeArea;
    store.mapImageBranch = store.currentBranch;
    resetImageImport();
    document.querySelector("#importAreaName").textContent =
      store.cafeMap.areas.find((a) => a.id === store.activeArea)?.name || "این فضا";
    document.querySelector("#imageImportPanel").hidden = false;
    const auto = document.querySelector("#analyzeMapImage");
    auto.hidden = true;
    try {
      const response = await fetch(`${apiUrl()}/analyze`),
        data = await response.json();
      if (
        document.querySelector("#imageImportPanel").hidden ||
        store.currentBranch !== store.mapImageBranch
      )
        return;
      auto.hidden = !response.ok || !data.enabled;
    } catch {}
    document.querySelector("#imageImportStatus").textContent = auto.hidden
      ? "تصویر را انتخاب کنید و جای میزها را روی آن مشخص کنید."
      : "تصویر را انتخاب کنید تا میزها شناسایی شوند.";
  };
  document.querySelector("#closeImageImport").onclick = closeImageImport;
  document.querySelector("#mapImageFile").onchange = async (event) => {
    const file = event.target.files?.[0];
    resetImageImport();
    const requestId = store.mapImageRequest,
      status = document.querySelector("#imageImportStatus");
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      status.textContent = "فقط تصویر JPG، PNG یا WebP تا ۸ مگابایت پذیرفته می‌شود.";
      return;
    }
    try {
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement("canvas"),
        ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      if (requestId !== store.mapImageRequest) return;
      store.mapImageData = canvas.toDataURL("image/jpeg", 0.76);
      if (store.mapImageData.length > 2100000)
        throw new Error("تصویر را کوچک‌تر کنید و دوباره انتخاب کنید.");
      document.querySelector("#mapImagePreview").src = store.mapImageData;
      document.querySelector("#imageImportPreview").hidden = false;
      document.querySelector("#analyzeMapImage").disabled = false;
      document.querySelector("#markMapImage").disabled = false;
      status.textContent = document.querySelector("#analyzeMapImage").hidden
        ? "تصویر آماده است. جای میزها را با لمس عکس مشخص کنید."
        : "تصویر آماده است. می‌توانید شناسایی خودکار را اجرا کنید یا جای میزها را با لمس عکس مشخص کنید.";
    } catch (error) {
      if (requestId !== store.mapImageRequest) return;
      store.mapImageData = "";
      status.textContent = error.message || "خواندن تصویر ممکن نشد.";
    }
  };
  document.querySelector("#analyzeMapImage").onclick = async (event) => {
    if (!store.mapImageData) return;
    const requestId = store.mapImageRequest,
      button = event.currentTarget,
      status = document.querySelector("#imageImportStatus"),
      mark = document.querySelector("#markMapImage");
    button.disabled = true;
    mark.disabled = true;
    mark.classList.remove("active");
    document.querySelector("#imageImportPreview").classList.remove("marking");
    status.textContent = "در حال بررسی تصویر…";
    try {
      const response = await fetch(`${apiUrl()}/analyze`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: store.mapImageData }),
        }),
        data = await response.json();
      if (requestId !== store.mapImageRequest) return;
      if (!response.ok) throw new Error(data.message || "تحلیل تصویر ممکن نشد.");
      store.mapImageDraft = data.tables || [];
      renderImageMarkers();
      status.textContent = store.mapImageDraft.length
        ? `${faDigits(store.mapImageDraft.length)} میز پیشنهادی پیدا شد. موارد درست را انتخاب کنید و به نقشه بیفزایید.${data.note ? " " + data.note : ""}`
        : data.note || "میزی شناسایی نشد. تصویر واضح‌تری انتخاب کنید.";
    } catch (error) {
      if (requestId !== store.mapImageRequest) return;
      status.textContent = error.message;
    } finally {
      if (requestId === store.mapImageRequest) {
        button.disabled = !store.mapImageData;
        mark.disabled = !store.mapImageData;
      }
    }
  };
  document.querySelector("#markMapImage").onclick = (event) => {
    event.currentTarget.classList.toggle("active");
    document
      .querySelector("#imageImportPreview")
      .classList.toggle("marking", event.currentTarget.classList.contains("active"));
    document.querySelector("#imageImportStatus").textContent =
      event.currentTarget.classList.contains("active")
        ? "روی مرکز هر میز در تصویر بزنید. برای پایان دوباره همین دکمه را بزنید."
        : "میزها را بررسی و به نقشه اضافه کنید.";
  };
  document.querySelector("#imageImportPreview").onclick = (event) => {
    if (!document.querySelector("#markMapImage").classList.contains("active")) return;
    const img = document.querySelector("#mapImagePreview"),
      rect = img.getBoundingClientRect(),
      x = Math.round(((event.clientX - rect.left) / rect.width) * 100),
      y = Math.round(((event.clientY - rect.top) / rect.height) * 100);
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    store.mapImageDraft.push({ x, y, shape: "round", capacity: 2, confidence: "high" });
    renderImageMarkers();
    document.querySelector("#imageImportStatus").textContent =
      `${faDigits(store.mapImageDraft.length)} میز مشخص شد. شکل و ظرفیت میزها را بعد از افزودن ویرایش کنید.`;
  };
  document.querySelector("#applyMapImage").onclick = () => {
    if (store.currentBranch !== store.mapImageBranch || store.activeArea !== store.mapImageArea) {
      document.querySelector("#imageImportStatus").textContent =
        "بخش یا شعبه عوض شده است؛ دوباره تصویر را انتخاب کنید.";
      return;
    }
    const selected = [...document.querySelectorAll("#importMarkers input")]
        .map((input, i) => (input.checked ? store.mapImageDraft[i] : null))
        .filter(Boolean),
      img = document.querySelector("#mapImagePreview"),
      bounds = areaBounds(),
      ratio = Math.min(bounds.width / img.naturalWidth, bounds.height / img.naturalHeight),
      width = img.naturalWidth * ratio,
      height = img.naturalHeight * ratio,
      offsetX = (bounds.width - width) / 2,
      offsetY = (bounds.height - height) / 2;
    for (const t of selected) {
      const size = tableSize(t),
        x = Math.max(
          0,
          Math.min(bounds.width - size.w, Math.round(offsetX + (width * t.x) / 100 - size.w / 2)),
        ),
        y = Math.max(
          0,
          Math.min(bounds.height - size.h, Math.round(offsetY + (height * t.y) / 100 - size.h / 2)),
        ),
        n = store.cafeMap.tables.length + 1;
      store.cafeMap.tables.push({
        id: `img-${crypto.randomUUID()}`,
        area: store.activeArea,
        name: `میز ${faDigits(n)}`,
        shape: t.shape,
        capacity: t.capacity,
        x,
        y,
        reservable: true,
      });
    }
    if (selected.length) {
      markDirty();
      renderEditor();
      closeImageImport();
      showPublishedToast(
        `${faDigits(selected.length)} میز به پیش‌نویس اضافه شد؛ جای آن‌ها را بررسی و منتشر کنید.`,
      );
    } else
      document.querySelector("#imageImportStatus").textContent = "دست‌کم یک میز را انتخاب کنید.";
  };
}
