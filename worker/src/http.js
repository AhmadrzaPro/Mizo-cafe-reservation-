export const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
export const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: jsonHeaders });
export const replyWithHeaders = (data, status, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } });
export function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}
// Client IP as reported by the trusted proxy in front of the app. The header name is configurable
// (CLIENT_IP_HEADER, default CF-Connecting-IP) so hosting can change. For a list such as
// X-Forwarded-For the right-most entry, added by the nearest proxy, is used. A missing or malformed
// value returns "unknown", which is limited as one shared client rather than skipped.
export function clientIp(request, env) {
  const values = String(
      request.headers.get(env?.CLIENT_IP_HEADER || "CF-Connecting-IP") || "",
    ).split(","),
    ip = values[values.length - 1].trim();
  return /^[0-9A-Fa-f:.]{2,45}$/.test(ip) ? ip : "unknown";
}
