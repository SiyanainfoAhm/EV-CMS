/** Duplicated from web src/types/ev.ts — align when monorepo is introduced */

export type UserRole = "SuperAdmin" | "SiteAdmin" | "User";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole | string;
  phone?: string;
  department?: string;
  avatarUrl?: string | null;
}

export interface ChargerConnector {
  id: string;
  connectorId: number;
  type: string;
  maxPowerKw: number;
  status: string;
}

export type ChargerStatusFilter = "all" | "online" | "offline" | "faulted";

export interface Charger {
  id: string;
  chargePointId: string;
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  type: string;
  maxPowerKw: number;
  status: string;
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  lastHeartbeat?: string | null;
  isSimulated?: boolean;
  tariffId?: string | null;
  allowAdminBypass?: boolean;
  connectors: ChargerConnector[];
  distanceKm?: number;
}

export type PrepaidMode = "amount" | "time";

/** Mapped from public."EV_PrepaidPlans" (mode/value/label schema). */
export interface EVPrepaidPlan {
  id: string;
  name: string;
  mode: PrepaidMode;
  /** INR for amount plans; minutes for time plans. */
  value: number;
  amount: number | null;
  durationMinutes: number | null;
  sortOrder: number;
  isActive: boolean;
  label?: string | null;
}

export interface PrepaidPaymentCalculation {
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  gstPercent: number;
  estimatedKwh: number | null;
  durationMinutes: number | null;
  ratePerKwh: number | null;
  powerKw: number | null;
  powerEstimated: boolean;
}

export interface ChargingSession {
  id: string;
  chargerId?: string;
  chargerName: string;
  chargePointId: string;
  connectorId: number;
  transactionId?: number | null;
  energyKwh: number;
  duration: string;
  status: string;
  startTime: string;
  endTime?: string;
  currentPowerKw?: number;
  soc?: number;
  amount?: number;
  paymentMode?: string | null;
  prepaidType?: string | null;
  prepaidMode?: "amount" | "time" | null;
  paymentStatus?: string | null;
  paymentId?: string | null;
  prepaidAmount?: number | null;
  prepaidTotalInr?: number | null;
  prepaidDurationMinutes?: number | null;
  prepaidEnergyCapKwh?: number | null;
  prepaidExpiresAt?: string | null;
  amountDue?: number | null;
  gatewayTxnId?: string | null;
}

export interface Payment {
  id: string;
  sessionId: string;
  totalAmount: number;
  status: string;
  createdAt: string;
  method?: string;
  receiptNumber?: string;
  receiptPdfUrl?: string;
}

export interface Receipt {
  id: string;
  paymentId: string;
  sessionId: string;
  receiptNumber: string;
  pdfUrl: string | null;
  amount: number;
  issuedAt?: string;
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
  subject: string;
  description: string;
  status: string;
  priority: string;
  category?: string;
  attachments: SupportTicketAttachment[];
  createdAt: string;
}

export interface UserProfile extends User {
  status?: string;
}

export interface PushToken {
  id: string;
  userId: string;
  token: string;
  platform: string;
}

export interface RFIDCard {
  id: string;
  uid: string;
  status: string;
  userId?: string | null;
  createdAt?: string;
}

export interface WalletAccount {
  id: string;
  userId: string;
  balanceAmount: number;
  holdAmount: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletSummary {
  walletAccountId: string;
  balanceAmount: number;
  holdAmount: number;
  usableBalance: number;
  currency: string;
  status: string;
}

export interface WalletLedgerEntry {
  id: string;
  walletAccountId: string;
  transactionType: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string;
  referenceId?: string | null;
  remarks?: string | null;
  createdAt: string;
}

export type PaymentOrderStatus =
  | "created"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired";

export interface PaymentOrder {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  gatewayName?: string | null;
  gatewayOrderId?: string | null;
  gatewayPaymentId?: string | null;
  checkoutUrl?: string | null;
  status: PaymentOrderStatus | string;
  walletCredited: boolean;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransaction {
  id: string;
  paymentOrderId: string;
  userId: string;
  gatewayName?: string | null;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface TopupOrderRequest {
  amount: number;
  gatewayName?: string;
  paymentMethod?: string;
}

export interface TopupOrderResponse {
  paymentOrderId: string;
  amount: number;
  status: string;
  message: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  referenceType?: string | null;
  referenceId?: string | null;
  data?: Record<string, unknown>;
  isRead: boolean;
  pushSent?: boolean;
  pushSentAt?: string | null;
  createdAt: string;
}
