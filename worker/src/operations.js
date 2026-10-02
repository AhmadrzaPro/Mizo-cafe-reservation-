import { hasPermission, permissionsFor } from "./auth/session.js";
import { availableTables, bookingTimeError, lockTimes } from "./availability.js";
import { reply } from "./http.js";
import { awardLoyaltyVisit } from "./loyalty.js";
import { dayRules } from "./settings.js";
import { minutes, subtractLocalMinutes, tehranNow, validDate, validTime } from "./util/dates.js";
import { randomId } from "./util/ids.js";
import { normalizeMobile } from "./util/mobile.js";
export function operationalReservation(row) {
  return {
    id: row.id,
    trackingCode: row.tracking_code,
    customerName: row.customer_name,
    mobile: row.mobile,
    partySize: row.party_size,
    date: row.reserved_at.slice(0, 10),
    time: row.reserved_at.slice(11, 16),
    durationMinutes: row.duration_minutes,
    status: row.status,
    source: row.source,
    notes: row.notes,
    internalNotes: row.internal_notes || "",
    tableIds: row.table_ids ? row.table_ids.split("|") : [],
    tables: row.table_names ? row.table_names.split("، ") : [],
    createdAt: row.created_at,
  };
}
export async function readOperations(db, branch, date, session, viewTime, settings) {
  const spaceMode = ["indoor", "outdoor", "both"].includes(branch.space_mode)
    ? branch.space_mode
    : "indoor";
  const [reservationsResult, tablesResult, waitlistResult] = await db.batch([
    db
      .prepare(
        "SELECT r.*,GROUP_CONCAT(t.id,'|') AS table_ids,GROUP_CONCAT(t.name,'، ') AS table_names FROM reservations r LEFT JOIN reservation_tables rt ON rt.reservation_id=r.id LEFT JOIN cafe_tables t ON t.id=rt.table_id WHERE r.branch_id=? AND r.reserved_at>=? AND r.reserved_at<? GROUP BY r.id ORDER BY r.reserved_at",
      )
      .bind(branch.id, `${date}T00:00`, `${date}T23:59`),
    db
      .prepare(
        "SELECT t.id,t.name,t.capacity,t.shape,t.position_x,t.position_y,t.reservable,t.operational_status,a.id AS area_id,a.name AS area_name,a.width AS area_width,a.height AS area_height FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=? AND (?='both' OR a.kind=?) ORDER BY a.sort_order,t.name",
      )
      .bind(branch.id, spaceMode, spaceMode),
    db
      .prepare(
        "SELECT id,customer_name,mobile,party_size,quoted_minutes,status,notes,created_at,updated_at FROM waitlist_entries WHERE branch_id=? AND status IN ('waiting','called') ORDER BY created_at",
      )
      .bind(branch.id),
  ]);
  const reservations = (reservationsResult.results || []).map(operationalReservation),
    now = tehranNow(),
    selectedTime = validTime(viewTime) ? viewTime : date === now.date ? now.time : "12:00",
    viewKey = `${date}T${selectedTime}`,
    viewMinute = minutes(selectedTime),
    tableRows = tablesResult.results || [],
    rules = await dayRules(db, branch, date),
    withinHours =
      viewKey >= now.key &&
      !rules.closed &&
      viewMinute >= minutes(rules.openTime) &&
      viewMinute + settings.reservationDuration <= minutes(rules.closeTime),
    freeIds = new Set(
      withinHours
        ? (await availableTables(db, date, selectedTime, settings, tableRows)).map((t) => t.id)
        : [],
    );
  const tables = tableRows.map((table) => {
    let liveStatus = table.operational_status || "available",
      reservation = null;
    const canQuickLock = Boolean(
      table.reservable && liveStatus === "available" && freeIds.has(table.id),
    );
    if (!["dirty", "inactive"].includes(liveStatus)) {
      const active = reservations.filter(
          (r) =>
            r.tableIds.includes(table.id) &&
            !["cancelled", "completed", "no_show"].includes(r.status),
        ),
        match = active.find((r) => {
          const start = minutes(r.time);
          return viewMinute >= start && viewMinute < start + r.durationMinutes;
        }),
        future = active
          .filter((r) => minutes(r.time) > viewMinute)
          .sort((a, b) => a.time.localeCompare(b.time))[0];
      if (match) {
        reservation = match;
        liveStatus = "occupied";
      } else if (future) {
        reservation = future;
        liveStatus = canQuickLock ? "available" : "upcoming";
      } else liveStatus = "available";
    }
    return {
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      shape: table.shape,
      x: table.position_x,
      y: table.position_y,
      reservable: Boolean(table.reservable),
      manualStatus: table.operational_status || "available",
      liveStatus,
      canQuickLock,
      areaId: table.area_id,
      areaName: table.area_name,
      areaWidth: table.area_width,
      areaHeight: table.area_height,
      reservation: reservation
        ? {
            trackingCode: reservation.trackingCode,
            customerName: reservation.customerName,
            time: reservation.time,
            partySize: reservation.partySize,
            source: reservation.source,
          }
        : null,
    };
  });
  const active = reservations.filter(
      (r) => !["cancelled", "completed", "no_show"].includes(r.status),
    ),
    occupied = tables.filter((t) => t.liveStatus === "occupied"),
    totalCapacity = tables
      .filter((t) => t.reservable && t.manualStatus !== "inactive")
      .reduce((s, t) => s + t.capacity, 0),
    usedCapacity = occupied.reduce((s, t) => s + t.capacity, 0),
    next =
      active
        .filter((r) => `${r.date}T${r.time}` >= viewKey)
        .sort((a, b) => a.time.localeCompare(b.time))[0] || null,
    delayed = active.filter(
      (r) => ["pending", "confirmed"].includes(r.status) && `${r.date}T${r.time}` < viewKey,
    ).length;
  const canReadReservations = hasPermission(session, "reservations.read"),
    canReadWaitlist = hasPermission(session, "waitlist.read"),
    visibleTables = canReadReservations
      ? tables
      : tables.map((table) => ({
          ...table,
          reservation: table.reservation ? { time: table.reservation.time } : null,
        }));
  return {
    date,
    viewTime: selectedTime,
    branch: { id: branch.id, name: branch.name },
    permissions: permissionsFor(session.role),
    stats: {
      reservations: canReadReservations ? active.length : 0,
      guests: canReadReservations ? active.reduce((s, r) => s + r.partySize, 0) : 0,
      occupiedTables: occupied.length,
      totalTables: tables.length,
      capacityPercent: totalCapacity ? Math.round((usedCapacity / totalCapacity) * 100) : 0,
      remainingCapacity: Math.max(0, totalCapacity - usedCapacity),
      waiting: canReadWaitlist
        ? (waitlistResult.results || []).filter((x) => x.status === "waiting").length
        : 0,
      delayed: canReadReservations ? delayed : 0,
    },
    nextReservation: canReadReservations ? next : null,
    reservations: canReadReservations ? reservations : [],
    tables: visibleTables,
    waitlist: canReadWaitlist
      ? (waitlistResult.results || []).map((x) => ({
          id: x.id,
          customerName: x.customer_name,
          mobile: x.mobile,
          partySize: x.party_size,
          quotedMinutes: x.quoted_minutes,
          status: x.status,
          notes: x.notes,
          createdAt: x.created_at,
        }))
      : [],
  };
}
export async function updateOperationalReservation(db, branch, code, body, settings) {
  const row = await db
    .prepare("SELECT * FROM reservations WHERE branch_id=? AND tracking_code=? LIMIT 1")
    .bind(branch.id, code)
    .first();
  if (!row) return reply({ error: "reservation_not_found", message: "رزرو پیدا نشد." }, 404);
  const name = String(body.customerName ?? row.customer_name)
      .trim()
      .slice(0, 70),
    mobile = body.mobile === undefined ? row.mobile : normalizeMobile(body.mobile) || "",
    partySize = Number(body.partySize ?? row.party_size),
    date = body.date || row.reserved_at.slice(0, 10),
    time = body.time || row.reserved_at.slice(11, 16),
    status = body.status || row.status,
    allowed = ["pending", "confirmed", "arrived", "completed", "cancelled", "no_show"];
  if (
    !name ||
    !validDate(date) ||
    !validTime(time) ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > settings.maxPartySize ||
    !allowed.includes(status)
  )
    return reply({ error: "invalid_reservation", message: "اطلاعات رزرو معتبر نیست." }, 400);
  if (["cancelled", "completed", "no_show"].includes(row.status))
    return reply(
      {
        error: "terminal_reservation",
        message: "رزرو بسته‌شده قابل تغییر نیست؛ رزرو تازه ثبت کنید.",
      },
      409,
    );
  if (row.payment_status === "pending" && ["confirmed", "arrived", "completed"].includes(status))
    return reply({ error: "payment_required", message: "بیعانه هنوز پرداخت نشده است." }, 409);
  let moving =
    date !== row.reserved_at.slice(0, 10) ||
    time !== row.reserved_at.slice(11, 16) ||
    partySize !== row.party_size;
  const previousTables = await db
    .prepare("SELECT table_id FROM reservation_tables WHERE reservation_id=?")
    .bind(row.id)
    .all();
  const previousIds = (previousTables.results || []).map((x) => x.table_id);
  const tableIds = Array.isArray(body.tableIds)
    ? [...new Set(body.tableIds.map(String))]
    : previousIds;
  if (!tableIds.length || tableIds.length > 4) return reply({ error: "table_required" }, 400);
  moving =
    moving ||
    tableIds.length !== previousIds.length ||
    tableIds.some((id) => !previousIds.includes(id));
  if (moving && !["cancelled", "completed", "no_show"].includes(status)) {
    const rules = await dayRules(db, branch, date);
    if (bookingTimeError(date, time, row.duration_minutes, rules, true))
      return reply(
        { error: "invalid_datetime", message: "زمان گذشته یا خارج از ساعت کاری مجاز نیست." },
        409,
      );
  }
  const marks = tableIds.map(() => "?").join(","),
    tableResult = await db
      .prepare(
        `SELECT t.id,t.name,t.capacity FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=? AND t.reservable=1 AND t.id IN (${marks})`,
      )
      .bind(branch.id, ...tableIds)
      .all(),
    tables = tableResult.results || [];
  if (moving && !["cancelled", "completed", "no_show"].includes(status)) {
    const blocked = await db
      .prepare(
        "SELECT t.id FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE t.id IN (" +
          marks +
          ") AND (t.operational_status!='available' OR (?!='both' AND a.kind!=?))",
      )
      .bind(...tableIds, branch.space_mode || "indoor", branch.space_mode || "indoor")
      .all();
    if (blocked.results?.length) return reply({ error: "table_unavailable" }, 409);
  }
  if (tables.length !== tableIds.length || tables.reduce((s, t) => s + t.capacity, 0) < partySize)
    return reply({ error: "invalid_table", message: "میز انتخابی یا ظرفیت آن معتبر نیست." }, 400);
  const now = new Date().toISOString(),
    internalNotes = body.internalNotes ?? row.internal_notes ?? "",
    statements = [
      db.prepare("DELETE FROM reservation_locks WHERE reservation_id=?").bind(row.id),
      db.prepare("DELETE FROM reservation_tables WHERE reservation_id=?").bind(row.id),
      db
        .prepare(
          "UPDATE reservations SET customer_name=?,mobile=?,party_size=?,reserved_at=?,status=?,notes=?,internal_notes=?,updated_at=? WHERE id=?",
        )
        .bind(
          name,
          mobile,
          partySize,
          `${date}T${time}`,
          status,
          String(body.notes ?? row.notes).slice(0, 240),
          String(internalNotes).slice(0, 500),
          now,
          row.id,
        ),
    ];
  if (["cancelled", "completed", "no_show"].includes(status))
    statements.push(
      db
        .prepare(
          "UPDATE sms_messages SET status='cancelled' WHERE reservation_id=? AND kind='reminder' AND status='queued'",
        )
        .bind(row.id),
    );
  else
    statements.push(
      db
        .prepare(
          "UPDATE sms_messages SET scheduled_at=?,mobile=?,customer_name=? WHERE reservation_id=? AND kind='reminder' AND status='queued'",
        )
        .bind(
          subtractLocalMinutes(`${date}T${time}`, settings.smsReminderMinutes),
          mobile,
          name,
          row.id,
        ),
    );
  for (const table of tables)
    statements.push(
      db
        .prepare("INSERT INTO reservation_tables (reservation_id,table_id) VALUES (?,?)")
        .bind(row.id, table.id),
    );
  if (!["cancelled", "completed", "no_show"].includes(status)) {
    for (const table of tables)
      for (const lock of lockTimes(
        date,
        time,
        row.duration_minutes,
        row.buffer_minutes,
        settings.slotInterval,
      ))
        statements.push(
          db
            .prepare(
              "INSERT INTO reservation_locks (id,reservation_id,table_id,lock_start) VALUES (?,?,?,?)",
            )
            .bind(`${table.id}:${lock}`, row.id, table.id, lock),
        );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    console.error("reservation_update_conflict", error);
    return reply({ error: "slot_taken", message: "این میز در زمان انتخابی رزرو دیگری دارد." }, 409);
  }
  if (status === "completed" && row.status !== "completed")
    try {
      await awardLoyaltyVisit(db, branch, row, now);
    } catch (error) {
      console.error("loyalty_award_failed", error);
    }
  return reply({ trackingCode: code, status });
}
export async function createWaitlist(db, branch, body) {
  const name = String(body.customerName || "")
      .trim()
      .slice(0, 70),
    mobile = body.mobile ? normalizeMobile(body.mobile) : "",
    partySize = Number(body.partySize),
    quoted = Math.max(0, Math.min(180, Number(body.quotedMinutes) || 20));
  if (
    !name ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > 30 ||
    (body.mobile && !mobile)
  )
    return reply({ error: "invalid_waitlist", message: "اطلاعات لیست انتظار معتبر نیست." }, 400);
  const now = new Date().toISOString(),
    id = randomId("wait");
  await db
    .prepare(
      "INSERT INTO waitlist_entries (id,branch_id,customer_name,mobile,party_size,quoted_minutes,status,notes,created_at,updated_at) VALUES (?,?,?,?,? ,?,'waiting',?,?,?)",
    )
    .bind(
      id,
      branch.id,
      name,
      mobile,
      partySize,
      quoted,
      String(body.notes || "").slice(0, 240),
      now,
      now,
    )
    .run();
  return reply({ id, status: "waiting" }, 201);
}
export async function updateWaitlist(db, branch, id, body) {
  const allowed = ["waiting", "called", "seated", "cancelled"],
    status = body.status;
  if (!allowed.includes(status)) return reply({ error: "invalid_status" }, 400);
  const result = await db
    .prepare("UPDATE waitlist_entries SET status=?,updated_at=? WHERE id=? AND branch_id=?")
    .bind(status, new Date().toISOString(), id, branch.id)
    .run();
  return result.meta?.changes ? reply({ id, status }) : reply({ error: "waitlist_not_found" }, 404);
}
export async function updateTableStatus(db, branch, itemId, body) {
  const allowed = ["available", "dirty", "inactive"],
    status = body.status;
  if (!allowed.includes(status)) return reply({ error: "invalid_status" }, 400);
  const result = await db
    .prepare(
      "UPDATE cafe_tables SET operational_status=?,updated_at=? WHERE id=? AND id IN (SELECT t.id FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=?)",
    )
    .bind(status, new Date().toISOString(), decodeURIComponent(itemId), branch.id)
    .run();
  return result.meta?.changes
    ? reply({ id: decodeURIComponent(itemId), status })
    : reply({ error: "table_not_found" }, 404);
}
