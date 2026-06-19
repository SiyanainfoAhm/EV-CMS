import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as paymentService from "../services/paymentService";
import * as walletService from "../services/walletService";
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
  const {
    paymentOrderId,
    returnSessionId,
    razorpayOrderId: routeRazorpayOrderId,
    razorpayPaymentId: routeRazorpayPaymentId,
    initialStatus,
    initialWalletCredited,
    initialMessage,
    initialCheckoutFailed,
    initialErrorDetail,
  } = route.params;
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [checkoutFailed, setCheckoutFailed] = useState(Boolean(initialCheckoutFailed));
  const [bannerMessage, setBannerMessage] = useState(initialMessage ?? "");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await paymentService.refreshTopupOrderStatus(paymentOrderId);
      if (data) {
        setOrder(data);
      } else if (initialStatus) {
        setOrder({
          id: paymentOrderId,
          userId: "",
          amount: 0,
          currency: "INR",
          gatewayOrderId: routeRazorpayOrderId ?? null,
          gatewayPaymentId: routeRazorpayPaymentId ?? null,
          status: initialStatus,
          walletCredited: Boolean(initialWalletCredited),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        setError(t("common.noData"));
      }

      if (data?.status === "paid" && data.walletCredited) {
        await walletService.refreshWallet();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [
    paymentOrderId,
    initialStatus,
    initialWalletCredited,
    routeRazorpayOrderId,
    routeRazorpayPaymentId,
    t,
  ]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    if (!checkoutFailed) {
      setBannerMessage("");
    }
    await load();
    setRefreshing(false);
  };

  const displayOrder = order;
  const showCredited = displayOrder?.status === "paid" && displayOrder.walletCredited;
  const gatewayOrderId = displayOrder?.gatewayOrderId ?? routeRazorpayOrderId;
  const gatewayPaymentId = displayOrder?.gatewayPaymentId ?? routeRazorpayPaymentId;
  const gatewayConfigured = paymentService.checkGatewayConfigured();
  const gatewayMessageKey = paymentService.getGatewayPendingMessage();

  const canResumeCheckout =
    paymentService.canOpenRazorpayCheckout() &&
    Boolean(gatewayOrderId) &&
    !gatewayPaymentId &&
    (displayOrder?.status === "pending" || displayOrder?.status === "created" || checkoutFailed);

  const showCheckoutNotOpened =
    checkoutFailed ||
    (Boolean(gatewayOrderId) &&
      !gatewayPaymentId &&
      (displayOrder?.status === "pending" || displayOrder?.status === "created") &&
      !paymentService.canOpenRazorpayCheckout());

  const onCompletePayment = async () => {
    setPaying(true);
    setError("");
    try {
      const result = await paymentService.resumeRazorpayTopup(paymentOrderId);
      setCheckoutFailed(Boolean(result.checkoutFailed));
      if (result.cancelled) {
        setBannerMessage(t("razorpay.paymentCancelled"));
      } else if (result.checkoutFailed) {
        const detail =
          result.errorMessage === "RAZORPAY_REQUIRES_DEV_BUILD"
            ? t("razorpay.requiresDevBuild")
            : result.errorMessage === "RAZORPAY_NATIVE_UNAVAILABLE"
              ? t("razorpay.nativeUnavailable")
              : result.errorMessage && result.errorMessage !== "PAYMENT_FAILED"
                ? result.errorMessage
                : t("razorpay.checkoutNotOpened");
        setBannerMessage(detail);
        Alert.alert(t("common.error"), detail);
      } else if (result.walletCredited || result.status === "paid") {
        setBannerMessage(t("razorpay.verificationSuccess"));
        setCheckoutFailed(false);
      } else {
        setBannerMessage(t("razorpay.verificationPending"));
      }

      if (result.razorpayPaymentId) {
        setOrder((prev) =>
          prev
            ? {
                ...prev,
                gatewayPaymentId: result.razorpayPaymentId ?? prev.gatewayPaymentId,
                status: result.status,
                walletCredited: result.walletCredited,
              }
            : prev
        );
      }

      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("common.error");
      setError(msg);
      Alert.alert(t("common.error"), msg);
    } finally {
      setPaying(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={t("payment.statusTitle")} onBack={() => navigation.goBack()} />

      {loading ? <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {bannerMessage ? <Text style={styles.banner}>{bannerMessage}</Text> : null}

      {displayOrder ? (
        <AppCard>
          <Text style={styles.statusTitle}>{t(statusTitleKey(displayOrder.status))}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.status")}</Text>
            <StatusBadge status={displayOrder.status} />
          </View>
          {displayOrder.amount > 0 ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t("payment.amount")}</Text>
              <Text style={styles.value}>{formatINR(displayOrder.amount)}</Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.orderId")}</Text>
            <Text style={styles.valueMono}>{displayOrder.id}</Text>
          </View>
          {gatewayOrderId ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t("payment.razorpayOrderId")}</Text>
              <Text style={styles.valueMono}>{gatewayOrderId}</Text>
            </View>
          ) : null}
          {gatewayPaymentId ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t("payment.razorpayPaymentId")}</Text>
              <Text style={styles.valueMono}>{gatewayPaymentId}</Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.walletCreditedLabel")}</Text>
            <Text style={styles.value}>
              {displayOrder.walletCredited ? t("payment.yes") : t("payment.no")}
            </Text>
          </View>

          {showCredited ? (
            <Text style={styles.success}>{t("payment.walletCredited")}</Text>
          ) : displayOrder.status === "cancelled" ? (
            <Text style={styles.pending}>{t("razorpay.paymentCancelled")}</Text>
          ) : displayOrder.status === "failed" ? (
            <Text style={styles.pending}>{t("razorpay.paymentFailed")}</Text>
          ) : showCheckoutNotOpened ? (
            <>
              <Text style={styles.pending}>{t("razorpay.checkoutNotOpened")}</Text>
              {!paymentService.canOpenRazorpayCheckout() ? (
                <Text style={styles.gateway}>{t("razorpay.requiresDevBuild")}</Text>
              ) : initialErrorDetail ? (
                <Text style={styles.error}>{initialErrorDetail}</Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.pending}>{t("payment.walletNotCredited")}</Text>
              <Text style={styles.pending}>{t("razorpay.verificationPending")}</Text>
            </>
          )}

          {!gatewayConfigured ? (
            <Text style={styles.gateway}>{t(gatewayMessageKey)}</Text>
          ) : null}

          {displayOrder.failureReason ? (
            <Text style={styles.error}>{displayOrder.failureReason}</Text>
          ) : null}
        </AppCard>
      ) : null}

      {canResumeCheckout ? (
        <AppButton
          title={t("razorpay.completePayment")}
          onPress={onCompletePayment}
          loading={paying}
          style={styles.btn}
        />
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
    gap: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: 14, flex: 1 },
  value: { fontWeight: "600", color: colors.text },
  valueMono: { fontFamily: "monospace", color: colors.text, fontSize: 11, flex: 1, textAlign: "right" },
  success: { marginTop: spacing.md, color: colors.emerald, fontWeight: "600" },
  pending: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  gateway: { marginTop: spacing.md, color: "#92400e", fontSize: 13, lineHeight: 20 },
  banner: { color: colors.text, marginBottom: spacing.sm, fontSize: 14, lineHeight: 20 },
  btn: { marginTop: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
