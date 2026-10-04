import { reply } from "./http.js";
import { writeMap } from "./map.js";
import { defaultSettings, writeSchedule, writeSettings } from "./settings.js";
import { defaultHours, readSetup, starterMap } from "./setup.js";
export async function branchRow(db, cafeSlug, branchSlug) {
  return db
    .prepare(
      "SELECT b.id,b.cafe_id,b.name,b.city,b.address,b.active,b.space_mode FROM branches b JOIN cafes c ON c.id=b.cafe_id WHERE c.slug=? AND b.slug=? AND b.active=1 LIMIT 1",
    )
    .bind(cafeSlug, branchSlug)
    .first();
}
export async function createBranch(db, body, session) {
  const current = await readSetup(db, null, session);
  if (!current.configured) return reply({ error: "setup_required" }, 409);
  const name = String(body.name || "")
      .trim()
      .slice(0, 80),
    city = String(body.city || "")
      .trim()
      .slice(0, 60),
    address = String(body.address || "")
      .trim()
      .slice(0, 180);
  if (name.length < 2 || city.length < 2) return reply({ error: "invalid_branch" }, 400);
  const slug = `branch-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  await writeMap(db, current.cafe.slug, slug, {
    cafeName: current.cafe.name,
    branchName: name,
    city,
    address,
    map: starterMap,
  });
  await writeSettings(db, current.cafe.slug, slug, {
    ...defaultSettings,
    cafeName: current.cafe.name,
    branchName: name,
    city,
    address,
  });
  await writeSchedule(db, await branchRow(db, current.cafe.slug, slug), {
    hours: defaultHours(),
    closures: [],
  });
  return reply(await readSetup(db, null, session), 201);
}
export async function updateBranch(db, slug, body, session) {
  const current = await readSetup(db, null, session),
    branch = current.branches?.find((b) => b.slug === slug);
  if (!branch) return reply({ error: "branch_not_found" }, 404);
  const name = String(body.name ?? branch.name)
      .trim()
      .slice(0, 80),
    city = String(body.city ?? branch.city)
      .trim()
      .slice(0, 60),
    address = String(body.address ?? branch.address)
      .trim()
      .slice(0, 180),
    active = body.active !== false;
  if (name.length < 2 || city.length < 2) return reply({ error: "invalid_branch" }, 400);
  if (!active && branch.active && current.branches.filter((b) => b.active).length === 1)
    return reply({ error: "last_active_branch", message: "حداقل یک شعبه باید فعال بماند." }, 409);
  await db
    .prepare(
      "UPDATE branches SET name=?,city=?,address=?,active=?,updated_at=? WHERE id=? AND cafe_id=?",
    )
    .bind(name, city, address, active ? 1 : 0, new Date().toISOString(), branch.id, session.cafe_id)
    .run();
  return reply(await readSetup(db, null, session));
}
