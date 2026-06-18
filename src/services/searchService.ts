import * as chargerService from "@/services/chargerService";
import * as sessionService from "@/services/sessionService";
import * as userService from "@/services/userService";

export interface GlobalSearchResult {
  id: string;
  type: "charger" | "session" | "user";
  title: string;
  subtitle: string;
  path: string;
}

export async function globalSearch(query: string, limit = 8): Promise<GlobalSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const [chargers, sessions, users] = await Promise.all([
    chargerService.getChargers({ search: query, limit: 20 }),
    sessionService.getSessionHistory({ search: query, limit: 30 }),
    userService.getUsers(),
  ]);

  const results: GlobalSearchResult[] = [];

  for (const c of chargers) {
    if (
      c.name.toLowerCase().includes(q) ||
      c.chargePointId.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q)
    ) {
      results.push({
        id: c.id,
        type: "charger",
        title: c.name,
        subtitle: `${c.chargePointId} · ${c.location}`,
        path: `/chargers/${c.id}`,
      });
    }
  }

  for (const s of sessions) {
    if (
      String(s.transactionId).includes(q) ||
      s.userName.toLowerCase().includes(q) ||
      s.chargerName.toLowerCase().includes(q) ||
      (s.rfidTag ?? "").toLowerCase().includes(q)
    ) {
      results.push({
        id: s.id,
        type: "session",
        title: `Session #${s.transactionId}`,
        subtitle: `${s.userName} · ${s.chargerName}`,
        path: "/sessions",
      });
    }
  }

  for (const u of users) {
    if (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) {
      results.push({
        id: u.id,
        type: "user",
        title: u.name,
        subtitle: u.email,
        path: "/users",
      });
    }
  }

  return results.slice(0, limit);
}
