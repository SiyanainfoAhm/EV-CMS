import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import AppCard from "../components/AppCard";
import SessionCard from "../components/SessionCard";
import UserAvatar from "../components/UserAvatar";
import NotificationBell from "../components/NotificationBell";
import { useAuth } from "../context/AuthContext";
import * as chargerService from "../services/chargerService";
import * as sessionService from "../services/sessionService";
import * as customNotificationService from "../services/customNotificationService";
import SimulationModeBadge from "../components/SimulationModeBadge";
import { isSimulationEnabled } from "../utils/simulationMode";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import { getMobileMenuRoutes } from "../utils/rfpRoles";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import { isOfflineByHeartbeat, isOnlineByHeartbeat } from "../utils/chargerConnectivity";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const MENU_LABEL_KEYS: Record<string, string> = {
  Chargers: "dashboard.chargers",
  NearestMap: "dashboard.nearestChargers",
  QRStart: "dashboard.scanQr",
  LiveSession: "dashboard.activeSession",
  SessionHistory: "dashboard.sessionHistory",
  PaymentHistory: "dashboard.paymentHistory",
  Wallet: "dashboard.wallet",
  RFIDBinding: "dashboard.rfidDetails",
  Profile: "dashboard.profile",
  Support: "dashboard.support",
  SupportTickets: "dashboard.myTickets",
};

const ALL_MENU_ITEMS: { route: keyof RootStackParamList }[] = [
  { route: "Chargers" },
  { route: "NearestMap" },
  { route: "QRStart" },
  { route: "LiveSession" },
  { route: "Wallet" },
  { route: "SessionHistory" },
  { route: "PaymentHistory" },
  { route: "RFIDBinding" },
  { route: "Profile" },
  { route: "Support" },
  { route: "SupportTickets" },
];

export default function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
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
  const [unreadNotifs, setUnreadNotifs] = useState(0);

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

  useEffect(() => {
    if (userId) load();
    else setLoading(false);
  }, [userId, load]);

  useFocusEffect(
    useCallback(() => {
      if (userId) load();
      refreshUser().catch(() => undefined);
      if (userId) {
        customNotificationService.getUnreadNotificationCount(userId).then(setUnreadNotifs).catch(() => undefined);
      }
    }, [userId, load, refreshUser])
  );

  useEffect(() => {
    if (!userId) return;
    return customNotificationService.subscribeToMyNotifications(userId, () => {
      customNotificationService.getUnreadNotificationCount(userId).then(setUnreadNotifs).catch(() => undefined);
    });
  }, [userId]);

  useSupabaseRealtime(
    useCallback(() => {
      if (userId) load();
    }, [userId, load])
  );

  const navigateMenu = (route: keyof RootStackParamList) => {
    switch (route) {
      case "QRStart":
        navigation.navigate("QRStart", {});
        break;
      case "Chargers":
        navigation.navigate("Chargers");
        break;
      case "NearestMap":
        navigation.navigate("NearestMap");
        break;
      case "LiveSession":
        navigation.navigate("LiveSession");
        break;
      case "SessionHistory":
        navigation.navigate("SessionHistory");
        break;
      case "PaymentHistory":
        navigation.navigate("PaymentHistory");
        break;
      case "Wallet":
        navigation.navigate("Wallet");
        break;
      case "RFIDBinding":
        navigation.navigate("RFIDBinding");
        break;
      case "Profile":
        navigation.navigate("Profile");
        break;
      case "Support":
        navigation.navigate("Support");
        break;
      case "SupportTickets":
        navigation.navigate("SupportTickets");
        break;
      default:
        break;
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greet}>{t("dashboard.hello", { name: user?.name?.split(" ")[0] ?? "User" })}</Text>
          <Text style={styles.sub}>{t("dashboard.subtitle")}</Text>
        </View>
        <View style={styles.headerActions}>
          <NotificationBell
            count={unreadNotifs}
            onPress={() => navigation.navigate("Notifications")}
          />
          <Pressable onPress={() => navigation.navigate("Profile")}>
            <UserAvatar name={user?.name} avatarUrl={user?.avatarUrl} size={44} />
          </Pressable>
        </View>
      </View>

      {loading && !hasLoaded ? (
        <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isMobileAdmin ? <AdminNoticeBanner /> : null}
      {isSimulationEnabled() ? <SimulationModeBadge compact /> : null}

      <AppCard style={styles.statCard}>
        <Text style={styles.statLabel}>{t("dashboard.onlineOffline")}</Text>
        <Text style={styles.statValue}>
          {onlineCount} · {offlineCount} · {chargingCount}
        </Text>
      </AppCard>

      {hasActive && !isMobileAdmin && (
        <Pressable onPress={() => navigation.navigate("LiveSession")}>
          <AppCard style={styles.activeCard}>
            <Text style={styles.activeTitle}>{t("dashboard.chargingInProgress")}</Text>
            <Text style={styles.activeLink}>{t("dashboard.viewLiveSession")}</Text>
          </AppCard>
        </Pressable>
      )}

      {recent.length > 0 && (
        <>
          <Text style={styles.section}>{t("dashboard.recentSessions")}</Text>
          {recent.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </>
      )}

      <Text style={styles.section}>{t("dashboard.quickActions")}</Text>
      {menuItems.map((item) => (
        <Pressable
          key={item.route}
          onPress={() => navigateMenu(item.route)}
        >
          <AppCard style={styles.menuItem}>
            <Text style={styles.menuText}>{t(MENU_LABEL_KEYS[item.route] ?? item.route)}</Text>
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
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
