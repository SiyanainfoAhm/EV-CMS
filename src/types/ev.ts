export type UserRole = "SuperAdmin" | "SiteAdmin" | "User";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole | string;
  department?: string;
  status: string;
  rfidBound?: string | null;
  joinedDate?: string;
  lastLogin?: string;
  lastLoginAt?: string | null;
  phone?: string;
  avatarUrl?: string | null;
  employeeId?: string | null;
}

export interface ChargerConnector {
  id: string;
  connectorId: number;
  type: string;
  maxPowerKw: number;
  status: string;
}

export interface Charger {
  id: string;
  chargePointId: string;
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  type: string;
  maxPowerKw: number;
  status: string;
  lastHeartbeat?: string | null;
  location: string;
  isSimulated?: boolean;
  /** Lab/test only — admin may Start without prepaid. */
  allowAdminBypass?: boolean;
  connectivity?: "online" | "offline" | "stale";
  tariffId?: string | null;
  tariff?: Tariff | null;
  connectors: ChargerConnector[];
}

export type PrepaidMode = "amount" | "time";
export type SettlementStatus = "paid" | "active" | "settled" | "refunded" | "failed_start";
export type PaymentKind = "prepaid" | "refund";

export interface PrepaidPlan {
  id: string;
  mode: PrepaidMode;
  value: number;
  label: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ChargingSession {
  id: string;
  transactionId: number;
  chargerId?: string;
  chargerName: string;
  chargePointId: string;
  connectorId: number;
  connectorType: string;
  userName: string;
  userId: string;
  rfidTag?: string;
  startTime: string;
  endTime?: string;
  duration: string;
  energyKwh: number;
  currentPowerKw?: number;
  soc?: number;
  status: string;
  startMeter?: number;
  endMeter?: number;
  amount?: number;
  stopReason?: string;
  authMethod?: string;
  prepaidMode?: PrepaidMode | null;
  prepaidValue?: number | null;
  prepaidTotalInr?: number | null;
  prepaidEnergyCapKwh?: number | null;
  prepaidExpiresAt?: string | null;
  prepaidPaymentId?: string | null;
  settlementStatus?: SettlementStatus | null;
  settlementAmount?: number | null;
  refundAmount?: number | null;
}

export interface RFIDCard {
  id: string;
  uid: string;
  status: string;
  boundUser: string | null;
  boundUserId: string | null;
  createdAt: string;
  lastUsed: string | null;
  totalSessions: number;
}

export interface Tariff {
  id: string;
  name: string;
  ratePerKwh: number;
  sessionFee: number;
  gstPercent: number;
  appliesTo: string;
  isActive: boolean;
  isDefault?: boolean;
  region?: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  userEmail?: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  status: string;
  gateway: string | null;
  gatewayTxnId: string | null;
  reconciliation: string;
  /** prepaid charging or refund — no postpaid product path */
  paymentKind?: PaymentKind;
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentSessionSummary {
  id: string;
  chargerName: string;
  chargePointId: string;
  connectorId: number;
  energyKwh: number;
  startTime: string;
  endTime?: string | null;
  status: string;
}

export interface PaymentReceiptInfo {
  receiptNumber: string;
  pdfUrl: string | null;
  issuedAt: string;
}

export interface PaymentDetail extends Payment {
  session?: PaymentSessionSummary;
  receipt?: PaymentReceiptInfo;
}

export interface WalletAccount {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  balanceAmount: number;
  holdAmount: number;
  usableBalance: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletLedgerEntry {
  id: string;
  walletAccountId: string;
  userId: string;
  transactionType: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string;
  referenceId: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface PaymentOrder {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  currency: string;
  gatewayName: string | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  checkoutUrl: string | null;
  status: string;
  walletCredited: boolean;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeterValue {
  id: string;
  sessionId: string;
  chargerId: string;
  connectorId: number;
  timestamp: string;
  energyKwh: number;
  powerKw: number;
  soc?: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  ipAddress: string;
  createdAt: string;
}

export interface SupportTicketAttachment {
  name: string;
  path: string;
  url: string;
  mimeType: string;
  size?: number;
  uploadedAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  assignedToName: string | null;
  attachments: SupportTicketAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
}

export interface DashboardStats {
  totalChargers: number;
  onlineChargers: number;
  offlineChargers: number;
  faultedChargers: number;
  activeSessions: number;
  availableConnectors: number;
  totalEnergyTodayKwh: number;
  totalRevenueToday: number;
  totalSessionsToday: number;
  avgSessionDuration: string;
  peakPowerToday: number;
}

export type TimeRange = "today" | "week" | "month" | "quarter";

export interface Receipt {
  id: string;
  paymentId: string;
  sessionId: string;
  receiptNumber: string;
  totalAmount: number;
  issuedAt: string;
}
