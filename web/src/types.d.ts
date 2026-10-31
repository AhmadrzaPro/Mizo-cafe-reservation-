// Shapes of the API answers the page keeps in `store` and `state` (see docs/openapi.yaml).
// Only the fields the page reads are listed.

export interface ManagerSession {
  id: string;
  name: string;
  mobile: string;
  role: "owner" | "branch_manager" | "reception" | "barista";
  roleLabel: string;
  branchId: string | null;
  cafeId: string;
  cafeSlug: string;
  permissions: string[];
}

export interface OtpChallenge {
  id: string;
  mobile: string;
}

export interface PendingPayment {
  trackingCode: string;
  mobile: string;
}

export interface StaffMember {
  id: string;
  name: string;
  mobile: string;
  role: ManagerSession["role"];
  roleLabel: string;
  active: boolean;
  branchId: string | null;
  branchName: string;
}

export interface SmsMessage {
  id: string;
  kind: "confirmation" | "reminder";
  mobile: string;
  customerName: string;
  message: string;
  status: string;
  /** ISO UTC instant. */
  scheduledAt: string;
  sentAt: string | null;
  provider: string;
  error: string;
  createdAt: string;
}

export interface SmsData {
  mode: string;
  settings: { confirmationEnabled: boolean; reminderEnabled: boolean; reminderMinutes: number };
  stats: { total: number; sent: number; queued: number; failed: number };
  messages: SmsMessage[];
}

export interface SubscriptionEvent {
  id: string;
  type: string;
  fromPlan: string | null;
  toPlan: string | null;
  note: string;
  amountRials: number;
  createdAt: string;
}

export interface SubscriptionData {
  enabled: boolean;
  status: "trial" | "active" | "past_due" | "inactive";
  activeBranchCount: number;
  unitPriceRials: number;
  monthlyPriceRials: number;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  endsAt: string | null;
  graceEndsAt: string | null;
  bookingPaused: boolean;
  payment: {
    card: { cardNumber: string; cardHolder: string } | null;
    demo: boolean;
    pending: { id: string; amountRials: number; reference: string; createdAt: string } | null;
  };
  events: SubscriptionEvent[];
}

export interface ReportsData {
  days: number;
  start: string;
  branchId: string | null;
  summary: {
    reservations: number;
    guests: number;
    completed: number;
    noShow: number;
    uniqueCustomers: number;
    repeatCustomers: number;
    completionRate: number;
    noShowRate: number;
  };
  daily: { date: string; reservations: number; guests: number }[];
  busyHours: { hour: string; reservations: number }[];
  branches: { id: string; name: string; reservations: number; guests: number; completed: number }[];
}

export interface LoyaltyCustomer {
  id: string;
  name: string;
  mobile: string;
  points: number;
  completedVisits: number;
  lastSeenAt: string;
  createdAt: string;
}

export interface LoyaltyData {
  canWrite: boolean;
  pointsPerVisit: number;
  rewardThreshold: number;
  stats: { total: number; points: number; returning: number };
  customers: LoyaltyCustomer[];
}

export interface OpsReservation {
  id: string;
  trackingCode: string;
  customerName: string;
  mobile: string;
  partySize: number;
  date: string;
  time: string;
  durationMinutes: number;
  status: string;
  tables: string[];
  tableIds: string[];
  notes: string;
  internalNotes: string;
  source: string;
  createdAt: string;
}

export interface OpsTable {
  id: string;
  name: string;
  shape: "round" | "square" | "rect";
  capacity: number;
  x: number;
  y: number;
  reservable: boolean;
  manualStatus: "available" | "dirty" | "inactive";
  liveStatus: string;
  canQuickLock: boolean;
  areaId: string;
  areaName: string;
  areaWidth: number;
  areaHeight: number;
  reservation: {
    trackingCode?: string;
    customerName?: string;
    time: string;
    partySize?: number;
    source?: string;
  } | null;
}

export interface WaitlistEntry {
  id: string;
  customerName: string;
  mobile: string;
  partySize: number;
  quotedMinutes: number;
  status: string;
  notes: string;
  createdAt: string;
}

export interface OpsData {
  viewTime: string;
  branch: { id: string; name: string };
  permissions: string[];
  stats: {
    reservations: number;
    guests: number;
    occupiedTables: number;
    totalTables: number;
    capacityPercent: number;
    remainingCapacity: number;
    waiting: number;
    delayed: number;
  };
  reservations: OpsReservation[];
  tables: OpsTable[];
  waitlist: WaitlistEntry[];
  nextReservation: OpsReservation | null;
}

export interface OpeningHours {
  weekday: number;
  openTime: string;
  closeTime: string;
  closed: boolean;
}

export interface Closure {
  id?: string;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface Availability {
  date: string;
  closed: boolean;
  reason: string;
  openTime?: string;
  closeTime?: string;
  slots: { time: string; available: boolean; tableIds: string[]; remaining: number }[];
}

/** A table suggested by floor-plan analysis, before the owner accepts it. */
export interface DraftTable {
  /** Percent of the image width and height. */
  x: number;
  y: number;
  shape: "round" | "square" | "rect";
  capacity: number;
  confidence: "high" | "medium" | "low";
}

export interface CafeBranch {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  active?: boolean;
}

/** GET /api/setup: the café of the page and its branches. */
export interface CafeProfile {
  configured: boolean;
  cafe: { id?: string; slug: string; name: string; structure: "single" | "multi" };
  branches: CafeBranch[];
}
