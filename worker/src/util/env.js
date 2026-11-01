export function isDemo(env) {
  return env.DEMO_MODE === "true";
}
/**
 * Whether the platform offers the Virtual Cafe (3D table selection) to this café. Off unless
 * VIRTUAL_CAFE is `all`, or a comma-separated list of café slugs that includes this one. Each
 * branch's owner can still switch it off (branch_settings.virtual_cafe_enabled).
 * @param {{ VIRTUAL_CAFE?: string }} env
 * @param {string} cafeSlug
 */
export function virtualCafeOffered(env, cafeSlug) {
  const value = String(env.VIRTUAL_CAFE || "").trim();
  if (!value) return false;
  if (value === "all") return true;
  return value
    .split(",")
    .map((slug) => slug.trim())
    .includes(cafeSlug);
}
