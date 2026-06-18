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
  connectivity?: "online" | "offline" | "stale";
  tariffId?: string | null;
  tariff?: Tariff | null;
  connectors: ChargerConnector[];
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
  createdAt: string;
}

export interface Payment {
  id: string;
  sessionId: string;
  userName: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  status: string;
  gateway: string | null;
  gatewayTxnId: string | null;
  reconciliation: string;
  createdAt: string;
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
