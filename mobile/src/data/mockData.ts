import type { Charger, ChargingSession, Payment, RFIDCard, User } from "../types";

export const mockMobileUser: User = {
  id: "user-001",
  name: "Rajesh Kumar",
  email: "rajesh.kumar@dfccil.gov.in",
  role: "Operator",
  phone: "+91 98765 43210",
};

export const mockChargers: Charger[] = [
  {
    id: "chr-001",
    chargePointId: "MP-DC-001",
    name: "MP Fast Charger Station 1",
    type: "DC Fast",
    maxPowerKw: 60,
    status: "online",
    location: "DFCCIL Yard, New Delhi",
    distanceKm: 0.3,
    connectors: [
      { id: "c1", connectorId: 1, type: "CCS2", maxPowerKw: 30, status: "Charging" },
      { id: "c2", connectorId: 2, type: "CCS2", maxPowerKw: 30, status: "Available" },
    ],
  },
  {
    id: "chr-005",
    chargePointId: "MP-AC-001",
    name: "MP Slow Charger Bay 1",
    type: "AC Slow",
    maxPowerKw: 7.5,
    status: "online",
    location: "DFCCIL Staff Parking, Delhi",
    distanceKm: 0.8,
    connectors: [{ id: "c9", connectorId: 1, type: "Type2", maxPowerKw: 7.5, status: "Available" }],
  },
  {
    id: "chr-011",
    chargePointId: "TS-DC-001",
    name: "TS Fast Charger Station 1",
    type: "DC Fast",
    maxPowerKw: 60,
    status: "online",
    location: "DFCCIL Yard, Kolkata",
    distanceKm: 2.1,
    connectors: [
      { id: "c15", connectorId: 1, type: "CCS2", maxPowerKw: 30, status: "Available" },
      { id: "c16", connectorId: 2, type: "CCS2", maxPowerKw: 30, status: "Charging" },
    ],
  },
];

export const mockActiveSession: ChargingSession = {
  id: "sess-001",
  chargerName: "MP Fast Charger Station 1",
  chargePointId: "MP-DC-001",
  connectorId: 1,
  energyKwh: 38.5,
  duration: "2h 17m",
  status: "active",
  startTime: "2026-06-01T08:15:00Z",
  currentPowerKw: 28.4,
  soc: 78,
};

export const mockSessionHistory: ChargingSession[] = [
  {
    id: "sess-hist-001",
    chargerName: "MP Fast Charger Station 1",
    chargePointId: "MP-DC-001",
    connectorId: 1,
    energyKwh: 42.3,
    duration: "1h 45m",
    status: "completed",
    startTime: "2026-05-31T14:30:00Z",
    amount: 634.5,
  },
  {
    id: "sess-hist-002",
    chargerName: "MP Slow Charger Bay 1",
    chargePointId: "MP-AC-001",
    connectorId: 1,
    energyKwh: 16.8,
    duration: "2h 47m",
    status: "completed",
    startTime: "2026-05-30T07:45:00Z",
    amount: 154.9,
  },
];

export const mockPayments: Payment[] = [
  { id: "pay-001", sessionId: "sess-hist-001", totalAmount: 688, status: "success", createdAt: "2026-05-31T16:30:00Z" },
  { id: "pay-003", sessionId: "sess-hist-002", totalAmount: 154.9, status: "success", createdAt: "2026-06-01T10:32:00Z" },
];

export const mockRfidCards: RFIDCard[] = [
  { id: "rfid-001", uid: "RFID-DFCCIL-001", status: "active" },
  { id: "rfid-006", uid: "RFID-DFCCIL-006", status: "inactive" },
];
