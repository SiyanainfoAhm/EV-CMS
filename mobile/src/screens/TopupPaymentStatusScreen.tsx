import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as paymentService from "../services/paymentService";
import { formatINR } from "../utils/currency";
import type { PaymentOrder } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "TopupPaymentStatus">;

function statusTitleKey(status: string): string {
  switch (status) {
    case "created":
      return "payment.created";
    case "pending":
      return "payment.pending";
    case "paid":
      return "payment.success";
    case "failed":
      return "payment.failed";
    case "cancelled":
      return "payment.cancelled";
    case "expired":
      return "payment.expired";
    default:
      return "payment.pending";
  }
}

export default function TopupPaymentStatusScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { paymentOrderId, returnSessionId } = route.params;
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await paymentService.refreshTopupOrderStatus(paymentOrderId);
      setOrder(data);
      if (!data) setError(t("common.noData"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [paymentOrderId, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const showCredited = order?.status === "paid" && order.walletCredited;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={t("payment.statusTitle")} onBack={() => navigation.goBack()} />

      {loading ? <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {order ? (
        <AppCard>
          <Text style={styles.statusTitle}>{t(statusTitleKey(order.status))}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.status")}</Text>
            <StatusBadge status={order.status} />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.amount")}</Text>
            <Text style={styles.value}>{formatINR(order.amount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.orderId")}</Text>
            <Text style={styles.valueMono}>{order.id.slice(0, 8)}…</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.walletCreditedLabel")}</Text>
            <Text style={styles.value}>
              {order.walletCredited ? t("payment.yes") : t("payment.no")}
            </Text>
          </View>

          {showCredited ? (
            <Text style={styles.success}>{t("payment.walletCredited")}</Text>
          ) : (
            <>
              <Text style={styles.pending}>{t("payment.walletNotCredited")}</Text>
              <Text style={styles.pending}>{t("payment.webhookPending")}</Text>
            </>
          )}

          {!paymentService.checkGatewayConfigured() ? (
            <Text style={styles.gateway}>{t("payment.gatewayPendingMessage")}</Text>
          ) : null}

          {order.failureReason ? (
            <Text style={styles.error}>{order.failureReason}</Text>
          ) : null}
        </AppCard>
      ) : null}

      <AppButton
        title={t("payment.refreshStatus")}
        onPress={onRefresh}
        loading={refreshing}
        style={styles.btn}
      />
      <AppButton
        title={t("payment.backToWallet")}
        onPress={() => navigation.navigate("Wallet")}
        variant="outline"
        style={styles.btn}
      />
      {returnSessionId ? (
        <AppButton
          title={t("session.backToSessionPayment")}
          onPress={() =>
            navigation.navigate("SessionSummary", {
              sessionId: returnSessionId,
              focusPayment: true,
            })
          }
          style={styles.btn}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  statusTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: 14 },
  value: { fontWeight: "600", color: colors.text },
  valueMono: { fontFamily: "monospace", color: colors.text, fontSize: 12 },
  success: { marginTop: spacing.md, color: colors.emerald, fontWeight: "600" },
  pending: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  gateway: { marginTop: spacing.md, color: "#92400e", fontSize: 13, lineHeight: 20 },
  btn: { marginTop: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
