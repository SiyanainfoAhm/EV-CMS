import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  Pressable,
  RefreshControl,
  View,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as customNotificationService from "../services/customNotificationService";
import { navigateFromNotificationData } from "../navigation/navigationRef";
import { showLocalTestNotification } from "../services/notificationService";
import { useAuth } from "../context/AuthContext";
import type { AppNotification } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

function typeLabelKey(type: string): string {
  const map: Record<string, string> = {
    charging_started: "notifications.chargingStarted",
    charging_stopped: "notifications.chargingStopped",
    payment_success: "notifications.paymentSuccess",
    payment_failed: "notifications.paymentFailed",
    wallet_low_balance: "notifications.walletLowBalance",
    support_ticket_updated: "notifications.supportTicketUpdated",
    charger_fault: "notifications.chargerFault",
    charger_offline: "notifications.chargerOffline",
    session: "notifications.chargingStarted",
    success: "notifications.paymentSuccess",
    alert: "notifications.chargerFault",
    warning: "notifications.chargerOffline",
    info: "notifications.general",
    general: "notifications.general",
  };
  return map[type] ?? "notifications.general";
}

export default function NotificationsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [list, count] = await Promise.all([
        customNotificationService.getMyNotifications(),
        customNotificationService.getUnreadNotificationCount(),
      ]);
      setItems(list);
      setUnread(count);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("notifications.registrationFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!user?.id) return;
    return customNotificationService.subscribeToMyNotifications(user.id, () => {
      load();
    });
  }, [user?.id, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onPress = async (item: AppNotification) => {
    if (!item.isRead) {
      await customNotificationService.markNotificationAsRead(item.id);
      setUnread((c) => Math.max(0, c - 1));
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
    }
    const payload = {
      type: item.type,
      reference_id: item.referenceId,
      ...item.data,
    };
    navigateFromNotificationData(payload);
  };

  const markAll = async () => {
    await customNotificationService.markAllNotificationsAsRead();
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
    >
      <Header
        title={t("notifications.title")}
        subtitle={unread > 0 ? `${unread} ${t("notifications.unread")}` : undefined}
        onBack={() => navigation.goBack()}
      />

      {unread > 0 ? (
        <AppButton title={t("notifications.markAllAsRead")} onPress={markAll} variant="outline" style={styles.btn} />
      ) : null}

      {__DEV__ ? (
        <AppButton
          title="DEV: Local test push"
          onPress={() => showLocalTestNotification()}
          variant="outline"
          style={styles.btn}
        />
      ) : null}

      {loading ? <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && items.length === 0 && !error ? (
        <Text style={styles.empty}>{t("notifications.empty")}</Text>
      ) : null}

      {items.map((item) => (
        <Pressable key={item.id} onPress={() => onPress(item)}>
          <AppCard style={[styles.card, !item.isRead && styles.unreadCard]}>
            <View style={styles.row}>
              <Text style={styles.title}>{item.title}</Text>
              {!item.isRead ? <View style={styles.dot} /> : null}
            </View>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.meta}>
              {t(typeLabelKey(item.type))} · {new Date(item.createdAt).toLocaleString()}
            </Text>
          </AppCard>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  btn: { marginBottom: spacing.sm },
  card: { marginBottom: spacing.sm },
  unreadCard: { borderLeftWidth: 3, borderLeftColor: colors.emerald },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontWeight: "700", color: colors.text, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.emerald },
  body: { color: colors.text, marginTop: 6, lineHeight: 20 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
