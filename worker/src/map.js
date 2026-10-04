import { branchRow } from "./branches.js";
import { reply } from "./http.js";
import { idPart } from "./util/ids.js";
export const outdoorAreaName = (name) =>
  /(تراس|حیاط|روف|باغ|بالکن|فضای باز)/.test(String(name || ""));
export function normalizeMap(input) {
  const areas = Array.isArray(input?.areas) ? input.areas.slice(0, 20) : [],
    tables = Array.isArray(input?.tables) ? input.tables.slice(0, 200) : [];
  const normalizedAreas = areas.map((area, index) => ({
      id: idPart(area.id) || `area-${index + 1}`,
      name: String(area.name || `فضا ${index + 1}`).slice(0, 60),
      kind: area.kind === "outdoor" ? "outdoor" : "indoor",
      width: Number(area.width ?? 820),
      height: Number(area.height ?? 520),
      sortOrder: index,
    })),
    areaIds = new Set(normalizedAreas.map((area) => area.id));
  const normalizedTables = tables
      .filter((table) => areaIds.has(idPart(table.area)))
      .map((table, index) => ({
        id: idPart(table.id) || `table-${index + 1}`,
        area: idPart(table.area),
        name: String(table.name || `میز ${index + 1}`).slice(0, 60),
        shape: ["round", "square", "rect"].includes(table.shape) ? table.shape : "round",
        capacity: Math.max(1, Math.min(20, Number(table.capacity) || 2)),
        x: Number(table.x ?? 0),
        y: Number(table.y ?? 0),
        reservable: Boolean(table.reservable),
      })),
    kinds = new Set(normalizedAreas.map((area) => area.kind)),
    derived = kinds.size > 1 ? "both" : kinds.has("outdoor") ? "outdoor" : "indoor",
    requested = ["indoor", "outdoor", "both"].includes(input?.spaceMode)
      ? input.spaceMode
      : derived,
    spaceMode = requested === "both" && kinds.size < 2 ? derived : requested;
  return { spaceMode, areas: normalizedAreas, tables: normalizedTables };
}
export async function analyzeMapImage(request, env) {
  if (!env.OPENAI_API_KEY)
    return reply(
      {
        error: "image_analysis_unavailable",
        message:
          "تحلیل خودکار تصویر هنوز برای این کافه فعال نشده است. می‌توانید میزها را از ابزارهای نقشه اضافه کنید.",
      },
      503,
    );
  if (Number(request.headers.get("content-length") || 0) > 2200000)
    return reply(
      { error: "image_too_large", message: "تصویر را کوچک‌تر کنید و دوباره تلاش کنید." },
      413,
    );
  const body = await request.json(),
    image = body?.image;
  if (
    typeof image !== "string" ||
    image.length > 2100000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)
  )
    return reply({ error: "invalid_image", message: "تصویر معتبر نیست یا حجم آن زیاد است." }, 400);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["tables", "note"],
    properties: {
      note: { type: "string" },
      tables: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["x", "y", "shape", "capacity", "confidence"],
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            shape: { type: "string", enum: ["round", "square", "rect"] },
            capacity: { type: "integer" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
    },
  };
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.MAP_VISION_MODEL || "gpt-4.1-mini",
      store: false,
      max_output_tokens: 1300,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Identify physical cafe dining tables in this overhead photo or floor plan. Return only tables clearly visible; do not infer missing tables, counters, chairs, plants or decor as tables. x and y are the center of each table as percentages 0..100 of full image width and height. shape round/square/rect, estimated seating capacity, and confidence. If unsuitable image return empty tables and short Persian note. Persian note should describe uncertainty briefly.",
            },
            { type: "input_image", image_url: image, detail: "high" },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "cafe_map_draft", strict: true, schema } },
    }),
  });
  if (!upstream.ok) {
    console.error("map_vision_failed", upstream.status);
    return reply(
      { error: "analysis_failed", message: "تحلیل تصویر انجام نشد. دوباره تلاش کنید." },
      502,
    );
  }
  const output = await upstream.json(),
    raw = (output.output || [])
      .flatMap((item) => (item.type === "message" ? item.content || [] : []))
      .find((part) => part.type === "output_text")?.text;
  if (!raw)
    return reply(
      {
        error: "analysis_empty",
        message: "از این تصویر میز قابل تشخیص نبود. تصویر واضح‌تری انتخاب کنید.",
      },
      422,
    );
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    return reply(
      { error: "analysis_invalid", message: "پاسخ تصویر معتبر نبود. دوباره تلاش کنید." },
      502,
    );
  }
  const tables = (Array.isArray(draft.tables) ? draft.tables : [])
    .slice(0, 60)
    .filter(
      (t) =>
        Number.isFinite(t.x) &&
        Number.isFinite(t.y) &&
        t.x >= 0 &&
        t.x <= 100 &&
        t.y >= 0 &&
        t.y <= 100,
    )
    .map((t) => ({
      x: Math.round(t.x),
      y: Math.round(t.y),
      shape: ["round", "square", "rect"].includes(t.shape) ? t.shape : "round",
      capacity: Math.max(1, Math.min(20, Number(t.capacity) || 2)),
      confidence: ["high", "medium", "low"].includes(t.confidence) ? t.confidence : "low",
    }));
  return reply({ tables, note: String(draft.note || "").slice(0, 180) });
}
export async function readMap(db, cafeSlug, branchSlug) {
  const branch = await branchRow(db, cafeSlug, branchSlug);
  if (!branch) return null;
  const [areasResult, tablesResult] = await db.batch([
      db
        .prepare(
          "SELECT id,name,kind,width,height,sort_order FROM areas WHERE branch_id=? ORDER BY sort_order,id",
        )
        .bind(branch.id),
      db
        .prepare(
          "SELECT t.id,t.area_id,t.name,t.shape,t.capacity,t.position_x,t.position_y,t.reservable,t.operational_status FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=? ORDER BY t.name",
        )
        .bind(branch.id),
    ]),
    prefix = `${branch.id}:`,
    areas = (areasResult.results || []).map((row) => ({
      id: String(row.id).replace(prefix, ""),
      name: row.name,
      width: row.width,
      height: row.height,
      kind: row.kind === "outdoor" || outdoorAreaName(row.name) ? "outdoor" : "indoor",
    })),
    kinds = new Set(areas.map((area) => area.kind)),
    derived = kinds.size > 1 ? "both" : kinds.has("outdoor") ? "outdoor" : "indoor",
    spaceMode = ["indoor", "outdoor", "both"].includes(branch.space_mode)
      ? branch.space_mode
      : derived;
  return {
    branch: { slug: branchSlug, name: branch.name, city: branch.city, address: branch.address },
    spaceMode,
    areas,
    tables: (tablesResult.results || []).map((row) => ({
      id: String(row.id).replace(prefix, ""),
      area: String(row.area_id).replace(prefix, ""),
      name: row.name,
      shape: row.shape,
      capacity: row.capacity,
      x: row.position_x,
      y: row.position_y,
      reservable: Boolean(row.reservable),
      operationalStatus: row.operational_status || "available",
    })),
  };
}
export async function writeMap(db, cafeSlug, branchSlug, body) {
  const map = normalizeMap(body.map),
    now = new Date().toISOString(),
    cafeId = `cafe:${cafeSlug}`,
    branchId = `branch:${cafeSlug}:${branchSlug}`,
    statements = [
      db
        .prepare(
          "INSERT INTO cafes (id,slug,name,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name",
        )
        .bind(cafeId, cafeSlug, String(body.cafeName || cafeSlug).slice(0, 80), now),
      db
        .prepare(
          "INSERT INTO branches (id,cafe_id,slug,name,city,address,space_mode,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=excluded.city,address=excluded.address,space_mode=excluded.space_mode,updated_at=excluded.updated_at",
        )
        .bind(
          branchId,
          cafeId,
          branchSlug,
          String(body.branchName || branchSlug).slice(0, 80),
          String(body.city || "تهران").slice(0, 60),
          String(body.address || "").slice(0, 180),
          map.spaceMode,
          now,
        ),
    ];
  const areaIds = new Set(map.areas.map((area) => area.id)),
    tableIds = new Set(map.tables.map((table) => table.id));
  if (!areaIds.size || areaIds.size !== map.areas.length || tableIds.size !== map.tables.length)
    return reply(
      {
        error: "invalid_map",
        message: "شناسه بخش یا میز تکراری است؛ نقشه را دوباره بارگذاری کنید.",
      },
      400,
    );
  if ((body.map?.areas?.length || 0) > 20 || (body.map?.tables?.length || 0) > 200)
    return reply({ error: "map_limit", message: "هر شعبه حداکثر ۲۰ فضا و ۲۰۰ میز دارد." }, 400);
  const invalidArea = map.areas.some(
    (a) =>
      !Number.isInteger(a.width) ||
      !Number.isInteger(a.height) ||
      a.width < 200 ||
      a.height < 200 ||
      a.width > 4000 ||
      a.height > 4000,
  );
  if (invalidArea)
    return reply(
      { error: "invalid_area_dimensions", message: "ابعاد هر فضا باید بین ۵ تا ۱۰۰ متر باشد." },
      400,
    );
  const invalidPosition = map.tables.some((t) => {
    const a = map.areas.find((a) => a.id === t.area),
      w = t.shape === "rect" ? 118 : 76,
      h = t.shape === "rect" ? 70 : 76;
    return (
      !Number.isFinite(t.x) ||
      !Number.isFinite(t.y) ||
      t.x < 0 ||
      t.y < 0 ||
      t.x + w > a.width ||
      t.y + h > a.height
    );
  });
  if (invalidPosition)
    return reply(
      {
        error: "table_outside_area",
        message: "یک میز خارج از محدوده است؛ فضا را بزرگ‌تر کنید یا میز را به داخل منتقل کنید.",
      },
      400,
    );
  const existing = await db
    .prepare(
      "SELECT t.id,t.name,COUNT(rt.reservation_id) AS reservation_count FROM cafe_tables t JOIN areas a ON a.id=t.area_id LEFT JOIN reservation_tables rt ON rt.table_id=t.id WHERE a.branch_id=? GROUP BY t.id",
    )
    .bind(branchId)
    .all();
  const protectedTable = (existing.results || []).find(
    (row) =>
      Number(row.reservation_count) > 0 && !tableIds.has(String(row.id).slice(branchId.length + 1)),
  );
  if (protectedTable)
    return reply(
      {
        error: "table_has_reservations",
        message: `میز «${protectedTable.name}» سابقه رزرو دارد و حذف آن باعث از دست رفتن اطلاعات رزرو می‌شود. آن را غیرفعال کنید.`,
      },
      409,
    );
  for (const area of map.areas)
    statements.push(
      db
        .prepare(
          "INSERT INTO areas (id,branch_id,name,kind,sort_order,width,height) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,sort_order=excluded.sort_order,width=excluded.width,height=excluded.height",
        )
        .bind(
          `${branchId}:${area.id}`,
          branchId,
          area.name,
          area.kind,
          area.sortOrder,
          area.width,
          area.height,
        ),
    );
  for (const table of map.tables)
    statements.push(
      db
        .prepare(
          "INSERT INTO cafe_tables (id,area_id,name,shape,capacity,position_x,position_y,reservable,operational_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET area_id=excluded.area_id,name=excluded.name,shape=excluded.shape,capacity=excluded.capacity,position_x=excluded.position_x,position_y=excluded.position_y,reservable=excluded.reservable,updated_at=excluded.updated_at",
        )
        .bind(
          `${branchId}:${table.id}`,
          `${branchId}:${table.area}`,
          table.name,
          table.shape,
          table.capacity,
          table.x,
          table.y,
          table.reservable ? 1 : 0,
          "available",
          now,
        ),
    );
  if (map.tables.length) {
    const keep = map.tables.map((t) => `${branchId}:${t.id}`),
      marks = keep.map(() => "?").join(",");
    statements.push(
      db
        .prepare(
          `DELETE FROM cafe_tables WHERE id IN (SELECT t.id FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=? AND t.id NOT IN (${marks}))`,
        )
        .bind(branchId, ...keep),
    );
  } else
    statements.push(
      db
        .prepare(
          "DELETE FROM cafe_tables WHERE area_id IN (SELECT id FROM areas WHERE branch_id=?)",
        )
        .bind(branchId),
    );
  if (map.areas.length) {
    const keep = map.areas.map((a) => `${branchId}:${a.id}`),
      marks = keep.map(() => "?").join(",");
    statements.push(
      db
        .prepare(`DELETE FROM areas WHERE branch_id=? AND id NOT IN (${marks})`)
        .bind(branchId, ...keep),
    );
  }
  await db.batch(statements);
  return readMap(db, cafeSlug, branchSlug);
}
