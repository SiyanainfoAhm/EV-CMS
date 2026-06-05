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

export interface Charger {
  id: string;
  chargePointId: string;
  name: string;
  type: string;
  maxPowerKw: number;
  status: string;
  location: string;
  lastHeartbeat?: string | null;
  isSimulated?: boolean;
  connectors: ChargerConnector[];
  distanceKm?: number;
}

export interface ChargingSession {
  id: string;
  chargerName: string;
  chargePointId: string;
  connectorId: number;
  energyKwh: number;
  duration: string;
  status: string;
  startTime: string;
  endTime?: string;
  currentPowerKw?: number;
  soc?: number;
  amount?: number;
}

export interface Payment {
  id: string;
  sessionId: string;
  totalAmount: number;
  status: string;
  createdAt: string;
  receiptNumber?: string;
  receiptPdfUrl?: string;
}

export interface RFIDCard {
  id: string;
  uid: string;
  status: string;
  userId?: string | null;
}
