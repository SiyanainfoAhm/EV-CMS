import type {
  AuditLog,
  Charger,
  ChargerConnector,
  ChargingSession,
  DashboardStats,
  Payment,
  RFIDCard,
  Tariff,
  User,
} from "@/types/ev";
import type { UserRole } from "@/types/auth";
import { connectivityFromHeartbeat, isOfflineByHeartbeat, isOnlineByHeartbeat } from "@/utils/chargerConnectivity";

export function formatDuration(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function formatLastLogin(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function mapDisplayRole(role: string): string {
  if (role === "SuperAdmin" || role === "SiteAdmin") return "Admin";
  return role;
}

export function mapDbRoleToAuthRole(role: string): UserRole {
  if (role === "SuperAdmin") return "SuperAdmin";
  if (role === "SiteAdmin") return "SiteAdmin";
  if (role === "Viewer") return "Viewer";
  return "Operator";
}

/** UI form role labels → DB check constraint values */
export function mapUiRoleToDb(role: string): string {
  if (role === "Admin") return "SuperAdmin";
  if (role === "SiteAdmin") return "SiteAdmin";
  if (role === "Viewer") return "Viewer";
  return "Operator";
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function auditTypeFromEntity(entityType: string): string {
  const t = entityType.toLowerCase();
  if (t.includes("auth")) return "alert";
  if (t.includes("session")) return "session";
  if (t.includes("rfid")) return "rfid";
  if (t.includes("payment")) return "payment";
  if (t.includes("charger")) return "alert";
  return "session";
}

export function mapConnector(row: Record<string, unknown>): ChargerConnector {
  return {
    id: row.id as string,
    connectorId: row.connector_id as number,
    type: row.connector_type as string,
    maxPowerKw: Number(row.max_power_kw),
    status: row.status as string,
  };
}

export function mapCharger(
  row: Record<string, unknown>,
  connectors: Record<string, unknown>[]
): Charger {
  return {
    id: row.id as string,
    chargePointId: row.charge_point_id as string,
    name: row.name as string,
    manufacturer: (row.manufacturer as string) ?? "",
    model: (row.model as string) ?? "",
    serialNumber: (row.serial_number as string) ?? "",
    firmwareVersion: (row.firmware_version as string) ?? "",
    type: row.charger_type as string,
    maxPowerKw: Number(row.max_power_kw),
    status: row.status as string,
    lastHeartbeat: (row.last_heartbeat_at as string) ?? new Date().toISOString(),
    location: (row.location as string) ?? "",
    isSimulated: Boolean(row.is_simulated),
    connectivity: connectivityFromHeartbeat(row.last_heartbeat_at as string),
    connectors: connectors.map(mapConnector),
  };
}

export function mapSession(
  row: Record<string, unknown>,
  charger?: Record<string, unknown> | null,
  user?: Record<string, unknown> | null,
  rfid?: Record<string, unknown> | null
): ChargingSession {
  const startTime = row.start_time as string;
  const endTime = row.end_time as string | null;
  return {
    id: row.id as string,
    transactionId: row.transaction_id as number,
    chargerId: row.charger_id as string,
    chargerName: (charger?.name as string) ?? "",
    chargePointId: (charger?.charge_point_id as string) ?? "",
    connectorId: row.connector_id as number,
    connectorType: "",
    userName: (user?.full_name as string) ?? "",
    userId: row.user_id as string,
    rfidTag: (rfid?.uid as string) ?? undefined,
    startTime,
    endTime: endTime ?? undefined,
    duration: formatDuration(startTime, endTime),
    energyKwh: Number(row.energy_kwh ?? 0),
    currentPowerKw: row.current_power_kw != null ? Number(row.current_power_kw) : undefined,
    soc: row.soc != null ? Number(row.soc) : undefined,
    status: row.status as string,
    startMeter: row.start_meter != null ? Number(row.start_meter) : undefined,
    endMeter: row.end_meter != null ? Number(row.end_meter) : undefined,
    amount: row.amount != null ? Number(row.amount) : undefined,
    stopReason: (row.stop_reason as string) ?? undefined,
  };
}

export function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    name: row.full_name as string,
    email: row.email as string,
    role: mapDisplayRole(row.role as string),
    department: (row.department as string) ?? undefined,
    status: row.status as string,
    phone: (row.phone as string) ?? undefined,
    rfidBound: (row.rfid_uid as string) ?? null,
    joinedDate: row.created_at
      ? new Date(row.created_at as string).toISOString().slice(0, 10)
      : undefined,
    lastLogin: formatLastLogin(row.last_login_at as string),
  };
}

export function mapRfid(
  row: Record<string, unknown>,
  user?: Record<string, unknown> | null
): RFIDCard {
  return {
    id: row.id as string,
    uid: row.uid as string,
    status: row.status as string,
    boundUser: user ? (user.full_name as string) : null,
    boundUserId: (row.user_id as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString().slice(0, 10),
    lastUsed: (row.last_used_at as string) ?? null,
    totalSessions: Number(row.total_sessions ?? 0),
  };
}

export function mapTariff(row: Record<string, unknown>): Tariff {
  return {
    id: row.id as string,
    name: row.name as string,
    ratePerKwh: Number(row.rate_per_kwh),
    sessionFee: Number(row.session_fee),
    gstPercent: Number(row.gst_percent),
    appliesTo: row.applies_to as string,
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at as string).toISOString().slice(0, 10),
  };
}

export function mapPayment(
  row: Record<string, unknown>,
  user?: Record<string, unknown> | null
): Payment {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    userName: user ? (user.full_name as string) : "",
    amount: Number(row.amount),
    gstAmount: Number(row.gst_amount),
    totalAmount: Number(row.total_amount),
    status: row.status as string,
    gateway: (row.gateway as string) ?? null,
    gatewayTxnId: (row.gateway_txn_id as string) ?? null,
    reconciliation: (row.reconciliation_status as string) ?? "unmatched",
    createdAt: row.created_at as string,
  };
}

export function mapAuditLog(row: Record<string, unknown>, user?: Record<string, unknown> | null): AuditLog {
  return {
    id: row.id as string,
    userId: (row.user_id as string) ?? "",
    userName: user ? (user.full_name as string) : "System",
    action: row.action as string,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as string) ?? "",
    details: (row.details as string) ?? "",
    ipAddress: (row.ip_address as string) ?? "",
    createdAt: row.created_at as string,
  };
}

export function computeDashboardStats(
  chargers: Charger[],
  activeSessions: ChargingSession[],
  todayEnergyKwh: number,
  todayRevenue: number,
  todaySessionCount: number
): DashboardStats {
  const online = chargers.filter((c) => isOnlineByHeartbeat(c.lastHeartbeat)).length;
  const offline = chargers.filter((c) => isOfflineByHeartbeat(c.lastHeartbeat)).length;
  const faulted = chargers.filter((c) => c.status === "faulted").length;
  const availableConnectors = chargers.reduce(
    (sum, c) => sum + c.connectors.filter((x) => x.status === "Available").length,
    0
  );
  const peakPower = activeSessions.reduce((max, s) => Math.max(max, s.currentPowerKw ?? 0), 0);

  return {
    totalChargers: chargers.length,
    onlineChargers: online,
    offlineChargers: offline,
    faultedChargers: faulted,
    activeSessions: activeSessions.length,
    availableConnectors,
    totalEnergyTodayKwh: todayEnergyKwh,
    totalRevenueToday: todayRevenue,
    totalSessionsToday: todaySessionCount,
    avgSessionDuration: "1h 45m",
    peakPowerToday: peakPower,
  };
}
