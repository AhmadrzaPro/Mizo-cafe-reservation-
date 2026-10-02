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
