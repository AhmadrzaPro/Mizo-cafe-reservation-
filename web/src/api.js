import { state, store } from "./state.js";

export const readableError = (error, fallback) =>
  /[\u0600-\u06ff]/.test(String(error?.message || "")) ? error.message : fallback;
export async function safeResponseJson(response, fallback) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: fallback };
  }
}
export function cafeBaseUrl() {
  return `/api/cafes/${encodeURIComponent(store.currentCafeSlug)}/branches/${encodeURIComponent(store.currentBranch)}`;
}
export function apiUrl() {
  return `${cafeBaseUrl()}/map`;
}
export function settingsUrl() {
  return `${cafeBaseUrl()}/settings`;
}
export function availabilityUrl() {
  return `${cafeBaseUrl()}/availability?date=${state.date}&party_size=${state.guests}`;
}
export function reservationsUrl() {
  return `${cafeBaseUrl()}/reservations`;
}
export function scheduleUrl() {
  return `${cafeBaseUrl()}/schedule`;
}
