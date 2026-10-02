export const textTypes = {
  "/": "text/html; charset=utf-8",
  "/index.html": "text/html; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
  "/editor.css": "text/css; charset=utf-8",
  "/payments.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/saas-admin": "text/html; charset=utf-8",
  "/saas-admin.css": "text/css; charset=utf-8",
  "/saas-admin.js": "text/javascript; charset=utf-8",
};
export function decodeBase64(value) {
  const binary = atob(value),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
