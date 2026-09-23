import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const cafes = sqliteTable("cafes", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_cafes_slug").on(table.slug)]);

export const saasAdmins = sqliteTable("saas_admins", {
  id: text("id").primaryKey(),
  email: text("email").notNull().default(""),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const saasSubscriptions = sqliteTable("saas_subscriptions", {
  cafeId: text("cafe_id").primaryKey().references(() => cafes.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  plan: text("plan").notNull().default("starter"),
  status: text("status").notNull().default("inactive"),
  monthlyPriceRials: integer("monthly_price_rials").notNull().default(0),
  trialEndsAt: text("trial_ends_at"),
  currentPeriodEndsAt: text("current_period_ends_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_saas_subscriptions_status").on(table.status)]);

export const subscriptionEvents = sqliteTable("subscription_events", {
  id: text("id").primaryKey(),
  cafeId: text("cafe_id").notNull().references(() => cafes.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  fromPlan: text("from_plan"),
  toPlan: text("to_plan"),
  amountRials: integer("amount_rials").notNull().default(0),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_subscription_events_cafe_created").on(table.cafeId, table.createdAt)]);

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [uniqueIndex("idx_admin_users_email").on(table.email)]);

export const cafeMemberships = sqliteTable("cafe_memberships", {
  cafeId: text("cafe_id").notNull().references(() => cafes.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("manager"),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.cafeId, table.userId] }), index("idx_cafe_memberships_user_id").on(table.userId)]);

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  cafeId: text("cafe_id").notNull().references(() => cafes.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  city: text("city").notNull().default("تهران"),
  address: text("address").notNull().default(""),
  spaceMode: text("space_mode").notNull().default("indoor"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_branches_cafe_slug").on(table.cafeId, table.slug), index("idx_branches_cafe_id").on(table.cafeId)]);

export const branchSettings = sqliteTable("branch_settings", {
  branchId: text("branch_id").primaryKey().references(() => branches.id, { onDelete: "cascade" }),
  reservationsEnabled: integer("reservations_enabled", { mode: "boolean" }).notNull().default(true),
  autoConfirm: integer("auto_confirm", { mode: "boolean" }).notNull().default(true),
  reservationDuration: integer("reservation_duration").notNull().default(90),
  maxPartySize: integer("max_party_size").notNull().default(8),
  customerNotice: text("customer_notice").notNull().default(""),
  bufferMinutes: integer("buffer_minutes").notNull().default(15),
  slotInterval: integer("slot_interval").notNull().default(30),
  smsConfirmationEnabled: integer("sms_confirmation_enabled", { mode: "boolean" }).notNull().default(true),
  smsReminderEnabled: integer("sms_reminder_enabled", { mode: "boolean" }).notNull().default(true),
  smsReminderMinutes: integer("sms_reminder_minutes").notNull().default(120),
  depositEnabled: integer("deposit_enabled", { mode: "boolean" }).notNull().default(false),
  depositMode: text("deposit_mode").notNull().default("fixed"),
  depositAmountRials: integer("deposit_amount_rials").notNull().default(2000000),
  depositPeakOnly: integer("deposit_peak_only", { mode: "boolean" }).notNull().default(false),
  depositPeakStart: text("deposit_peak_start").notNull().default("18:00"),
  depositPeakEnd: text("deposit_peak_end").notNull().default("22:00"),
  paymentDeadlineMinutes: integer("payment_deadline_minutes").notNull().default(15),
  refundPolicy: text("refund_policy").notNull().default("تا ۲ ساعت قبل از زمان رزرو، بیعانه کامل بازگردانده می‌شود."),
  updatedAt: text("updated_at").notNull(),
});

export const staffMembers = sqliteTable("staff_members", {
  id: text("id").primaryKey(),
  cafeId: text("cafe_id").notNull().references(() => cafes.id, { onDelete: "cascade" }),
  branchId: text("branch_id").references(() => branches.id, { onDelete: "set null" }),
  mobile: text("mobile").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("reception"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_staff_cafe_mobile").on(table.cafeId, table.mobile), index("idx_staff_branch_id").on(table.branchId)]);

export const otpChallenges = sqliteTable("otp_challenges", {
  id: text("id").primaryKey(),
  mobile: text("mobile").notNull(),
  salt: text("salt").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: integer("consumed_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_otp_mobile_created").on(table.mobile, table.createdAt)]);

export const staffSessions = sqliteTable("staff_sessions", {
  id: text("id").primaryKey(),
  staffId: text("staff_id").notNull().references(() => staffMembers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
}, (table) => [uniqueIndex("idx_staff_sessions_token_hash").on(table.tokenHash), index("idx_staff_sessions_staff_id").on(table.staffId)]);

export const operatingHours = sqliteTable("operating_hours", {
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  openTime: text("open_time").notNull().default("10:00"),
  closeTime: text("close_time").notNull().default("23:00"),
  closed: integer("closed", { mode: "boolean" }).notNull().default(false),
}, (table) => [primaryKey({ columns: [table.branchId, table.weekday] })]);

export const closures = sqliteTable("closures", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_closures_branch_dates").on(table.branchId, table.startDate, table.endDate)]);

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  cafeId: text("cafe_id").notNull().references(() => cafes.id, { onDelete: "cascade" }),
  mobile: text("mobile").notNull(),
  name: text("name").notNull(),
  points: integer("points").notNull().default(0),
  completedVisits: integer("completed_visits").notNull().default(0),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_customers_cafe_mobile").on(table.cafeId, table.mobile)]);

export const reservations = sqliteTable("reservations", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
  trackingCode: text("tracking_code").notNull(),
  customerName: text("customer_name").notNull(),
  mobile: text("mobile").notNull(),
  partySize: integer("party_size").notNull(),
  reservedAt: text("reserved_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  bufferMinutes: integer("buffer_minutes").notNull().default(0),
  status: text("status").notNull().default("pending"),
  source: text("source").notNull().default("web"),
  notes: text("notes").notNull().default(""),
  internalNotes: text("internal_notes").notNull().default(""),
  depositAmountRials: integer("deposit_amount_rials").notNull().default(0),
  paymentStatus: text("payment_status").notNull().default("not_required"),
  paymentDueAt: text("payment_due_at"),
  paidAt: text("paid_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_reservations_tracking_code").on(table.trackingCode), index("idx_reservations_branch_reserved_at").on(table.branchId, table.reservedAt), index("idx_reservations_mobile").on(table.mobile)]);

export const loyaltyTransactions = sqliteTable("loyalty_transactions", {
  id: text("id").primaryKey(),
  cafeId: text("cafe_id").notNull().references(() => cafes.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  branchId: text("branch_id").references(() => branches.id, { onDelete: "set null" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  points: integer("points").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_loyalty_transactions_reservation").on(table.reservationId), index("idx_loyalty_transactions_cafe_created").on(table.cafeId, table.createdAt), index("idx_loyalty_transactions_customer_created").on(table.customerId, table.createdAt)]);

export const paymentTransactions = sqliteTable("payment_transactions", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("payment"),
  amountRials: integer("amount_rials").notNull(),
  status: text("status").notNull().default("success"),
  provider: text("provider").notNull().default("demo"),
  reference: text("reference").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_payment_transactions_branch_created").on(table.branchId, table.createdAt), index("idx_payment_transactions_reservation").on(table.reservationId)]);

export const smsMessages = sqliteTable("sms_messages", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  mobile: text("mobile").notNull(),
  customerName: text("customer_name").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("queued"),
  scheduledAt: text("scheduled_at").notNull(),
  sentAt: text("sent_at"),
  provider: text("provider").notNull().default("demo"),
  providerMessageId: text("provider_message_id"),
  error: text("error").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_sms_branch_created").on(table.branchId, table.createdAt), index("idx_sms_status_scheduled").on(table.status, table.scheduledAt)]);

export const reservationTables = sqliteTable("reservation_tables", {
  reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
  tableId: text("table_id").notNull().references(() => cafeTables.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.reservationId, table.tableId] }), index("idx_reservation_tables_table_id").on(table.tableId)]);

export const reservationLocks = sqliteTable("reservation_locks", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
  tableId: text("table_id").notNull().references(() => cafeTables.id, { onDelete: "cascade" }),
  lockStart: text("lock_start").notNull(),
}, (table) => [index("idx_reservation_locks_reservation_id").on(table.reservationId), index("idx_reservation_locks_table_id").on(table.tableId)]);

export const tableConnections = sqliteTable("table_connections", {
  tableAId: text("table_a_id").notNull().references(() => cafeTables.id, { onDelete: "cascade" }),
  tableBId: text("table_b_id").notNull().references(() => cafeTables.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.tableAId, table.tableBId] })]);

export const areas = sqliteTable("areas", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("indoor"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [index("idx_areas_branch_id").on(table.branchId)]);

export const cafeTables = sqliteTable("cafe_tables", {
  id: text("id").primaryKey(),
  areaId: text("area_id").notNull().references(() => areas.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shape: text("shape").notNull().default("round"),
  capacity: integer("capacity").notNull().default(2),
  positionX: real("position_x").notNull().default(0),
  positionY: real("position_y").notNull().default(0),
  reservable: integer("reservable", { mode: "boolean" }).notNull().default(true),
  operationalStatus: text("operational_status").notNull().default("available"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_cafe_tables_area_id").on(table.areaId)]);

export const waitlistEntries = sqliteTable("waitlist_entries", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  customerName: text("customer_name").notNull(),
  mobile: text("mobile").notNull().default(""),
  partySize: integer("party_size").notNull(),
  quotedMinutes: integer("quoted_minutes").notNull().default(20),
  status: text("status").notNull().default("waiting"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_waitlist_branch_status_created").on(table.branchId, table.status, table.createdAt)]);
