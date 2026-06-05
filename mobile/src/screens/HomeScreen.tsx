import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import AppCard from "../components/AppCard";
import SessionCard from "../components/SessionCard";
import UserAvatar from "../components/UserAvatar";
import { useAuth } from "../context/AuthContext";
import * as chargerService from "../services/chargerService";
import * as sessionService from "../services/sessionService";
import SimulationModeBadge from "../components/SimulationModeBadge";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import { getMobileMenuRoutes } from "../utils/rfpRoles";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import { isOfflineByHeartbeat, isOnlineByHeartbeat } from "../utils/chargerConnectivity";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const ALL_MENU_ITEMS: { label: string; route: keyof RootStackParamList }[] = [
  { label: "Find Chargers", route: "Chargers" },
  { label: "Live Session", route: "LiveSession" },
  { label: "Session History", route: "SessionHistory" },
  { label: "Payments", route: "PaymentHistory" },
  { label: "RFID Cards", route: "RFIDBinding" },
  { label: "Profile", route: "Profile" },
  { label: "Support", route: "Support" },
];

export default function HomeScreen({ navigation }: Props) {
  const { user, refreshUser, isMobileAdmin } = useAuth();
  const allowedRoutes = getMobileMenuRoutes(user?.role ?? "User");
  const menuItems = ALL_MENU_ITEMS.filter((item) => allowedRoutes.includes(item.route));
  const userId = user?.id;
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const [onlineCount, setOnlineCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const [chargingCount, setChargingCount] = useState(0);
  const [hasActive, setHasActive] = useState(false);
  const [recent, setRecent] = useState<ChargingSession[]>([]);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [chargers, active, sessions] = await Promise.all([
        chargerService.getChargers({ status: "all" }),
        sessionService.getActiveSession(userId),
        sessionService.getRecentSessions(userId, 3),
      ]);
      setOnlineCount(chargers.filter((c) => isOnlineByHeartbeat(c.lastHeartbeat)).length);
      setOfflineCount(chargers.filter((c) => isOfflineByHeartbeat(c.lastHeartbeat)).length);
      setChargingCount(
        chargers.reduce((n, c) => n + c.connectors.filter((x) => x.status === "Charging").length, 0)
      );
      setHasActive(!!active);
      setRecent(sessions.filter((s) => s.status !== "active"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [userId]);

  // Load when session user becomes available (e.g. right after restore/login).
  useEffect(() => {
    if (userId) load();
    else setLoading(false);
  }, [userId, load]);

  useFocusEffect(
    useCallback(() => {
      if (userId) load();
      refreshUser().catch(() => undefined);
    }, [userId, load, refreshUser])
  );

  useSupabaseRealtime(
    useCallback(() => {
      if (userId) load();
    }, [userId, load])
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greet}>Hello, {user?.name?.split(" ")[0] ?? "User"}</Text>
          <Text style={styles.sub}>DFCCIL EV Charging</Text>
        </View>
        <Pressable onPress={() => navigation.navigate("Profile")}>
          <UserAvatar name={user?.name} avatarUrl={user?.avatarUrl} size={44} />
        </Pressable>
      </View>

      {loading && !hasLoaded ? (
        <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isMobileAdmin ? <AdminNoticeBanner /> : null}
      <SimulationModeBadge compact />

      <AppCard style={styles.statCard}>
        <Text style={styles.statLabel}>Online · Offline · Charging connectors</Text>
        <Text style={styles.statValue}>
          {onlineCount} · {offlineCount} · {chargingCount}
        </Text>
      </AppCard>

      {hasActive && !isMobileAdmin && (
        <Pressable onPress={() => navigation.navigate("LiveSession")}>
          <AppCard style={styles.activeCard}>
            <Text style={styles.activeTitle}>Charging in progress</Text>
            <Text style={styles.activeLink}>View live session →</Text>
          </AppCard>
        </Pressable>
      )}

      {recent.length > 0 && (
        <>
          <Text style={styles.section}>Recent sessions</Text>
          {recent.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </>
      )}

      <Text style={styles.section}>Quick actions</Text>
      {menuItems.map((item) => (
        <Pressable
          key={item.route}
          onPress={() => navigation.navigate(item.route as Exclude<keyof RootStackParamList, "Login" | "ChargerDetail" | "QRStart">)}
        >
          <AppCard style={styles.menuItem}>
            <Text style={styles.menuText}>{item.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </AppCard>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  greet: { ...typography.h2, color: colors.text },
  sub: { color: colors.textMuted, marginTop: 4 },
  statLabel: { color: colors.textMuted, fontSize: 13 },
  statValue: { fontSize: 28, fontWeight: "700", color: colors.emerald, marginTop: 4 },
  statCard: { marginBottom: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
  activeCard: { backgroundColor: colors.navy, marginBottom: spacing.md, marginTop: spacing.sm },
  activeTitle: { color: colors.white, fontWeight: "600", fontSize: 16 },
  activeLink: { color: colors.emeraldLight, marginTop: 6 },
  section: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.sm },
  menuItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  menuText: { fontSize: 16, fontWeight: "500", color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
