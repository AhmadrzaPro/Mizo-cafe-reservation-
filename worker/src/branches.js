import { reply } from "./http.js";
import { branchLinkProblem, invalidLink, linkName } from "./links.js";
import { layoutStatements, starterLayout } from "./map.js";
import { defaultSettings, writeSchedule, writeSettings } from "./settings.js";
import { defaultHours, readSetup } from "./setup.js";
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
  if (!current.configured || !current.cafe) return reply({ error: "setup_required" }, 409);
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
  const link = linkName(body.link, "branch");
  if (link === null) return invalidLink();
  const linkProblem = link && (await branchLinkProblem(db, current.cafe.id, link, null));
  if (linkProblem) return linkProblem;
  const slug = `branch-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const branchId = `branch:${current.cafe.slug}:${slug}`,
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO branches (id,cafe_id,slug,name,city,address,space_mode,updated_at) VALUES (?,?,?,?,?,?,'indoor',?)",
      )
      .bind(branchId, current.cafe.id, slug, name, city, address, now),
    ...layoutStatements(db, branchId, starterLayout, now),
  ]);
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
  if (link)
    await db
      .prepare("UPDATE branches SET link_slug=? WHERE cafe_id=? AND slug=?")
      .bind(link, current.cafe.id, slug)
      .run();
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
    active = body.active !== false,
    link = body.link === undefined ? branch.link || "" : linkName(body.link, "branch");
  if (name.length < 2 || city.length < 2) return reply({ error: "invalid_branch" }, 400);
  if (link === null) return invalidLink();
  const linkProblem = link && (await branchLinkProblem(db, session.cafe_id, link, branch.id));
  if (linkProblem) return linkProblem;
  if (!active && branch.active && current.branches?.filter((b) => b.active).length === 1)
    return reply({ error: "last_active_branch", message: "حداقل یک شعبه باید فعال بماند." }, 409);
  await db
    .prepare(
      "UPDATE branches SET name=?,city=?,address=?,active=?,link_slug=?,updated_at=? WHERE id=? AND cafe_id=?",
    )
    .bind(
      name,
      city,
      address,
      active ? 1 : 0,
      link || null,
      new Date().toISOString(),
      branch.id,
      session.cafe_id,
    )
    .run();
  return reply(await readSetup(db, null, session));
}
