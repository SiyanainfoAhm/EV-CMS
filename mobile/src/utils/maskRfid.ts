/** Mask RFID UID for display — show first/last segments only. */
export function maskRfidUid(uid: string): string {
  if (uid.length <= 8) return uid;
  const prefix = uid.slice(0, 6);
  const suffix = uid.slice(-3);
  return `${prefix}•••${suffix}`;
}
