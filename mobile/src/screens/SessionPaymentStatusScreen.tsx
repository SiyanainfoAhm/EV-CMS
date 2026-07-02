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
import { formatINR } from "../utils/currency";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "SessionPaymentStatus">;

function statusTitleKey(status: string): string {
  switch (status) {
    case "created":
    case "pending":
      return "payment.pending";
    case "success":
    case "paid":
      return "payment.success";
    case "failed":
      return "payment.failed";
    case "cancelled":
      return "payment.cancelled";
    default:
      return "payment.pending";
  }
}

export default function SessionPaymentStatusScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const {
    sessionId,
    paymentId,
    razorpayOrderId,
    razorpayPaymentId,
    amount,
    initialStatus,
    initialMessage,
    initialCheckoutFailed,
    initialErrorDetail,
    receiptNumber,
  } = route.params;

  const [status, setStatus] = useState(initialStatus ?? "pending");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [checkoutFailed, setCheckoutFailed] = useState(Boolean(initialCheckoutFailed));
  const [bannerMessage, setBannerMessage] = useState(initialMessage ?? "");
  const [resolvedReceipt, setResolvedReceipt] = useState(receiptNumber ?? "");

  const load = useCallback(async () => {
    setError("");
    try {
      const payment = await paymentService.getSessionPayment(sessionId);
      if (payment) {
        setStatus(payment.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

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

  const gatewayConfigured = paymentService.checkGatewayConfigured();
  const gatewayMessageKey = paymentService.getGatewayPendingMessage();
  const paid = status === "success" || status === "paid";

  const canResumeCheckout =
    paymentService.canOpenRazorpayCheckout() &&
    Boolean(razorpayOrderId) &&
    !razorpayPaymentId &&
    !paid &&
    (status === "pending" || checkoutFailed);

  const showCheckoutNotOpened =
    checkoutFailed ||
    (Boolean(razorpayOrderId) &&
      !razorpayPaymentId &&
      !paid &&
      (status === "pending" || status === "created") &&
      !paymentService.canOpenRazorpayCheckout());

  const onCompletePayment = async () => {
    if (!razorpayOrderId) return;
    setPaying(true);
    setError("");
    try {
      const result = await paymentService.resumeRazorpaySessionPayment(
        sessionId,
        paymentId,
        razorpayOrderId,
        amount
      );
      setCheckoutFailed(Boolean(result.checkoutFailed));
      setStatus(result.status);

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
      } else if (result.status === "success" || result.status === "paid") {
        setBannerMessage(t("session.paymentSuccess"));
        setCheckoutFailed(false);
        if (result.receiptNumber) {
          setResolvedReceipt(result.receiptNumber);
        }
      } else {
        setBannerMessage(t("razorpay.verificationPending"));
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

      <AppCard>
        <Text style={styles.statusTitle}>{t(statusTitleKey(status))}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>{t("payment.status")}</Text>
          <StatusBadge status={status} />
        </View>
        {amount > 0 ? (
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.amount")}</Text>
            <Text style={styles.value}>{formatINR(amount)}</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.label}>{t("session.sessionId")}</Text>
          <Text style={styles.valueMono}>{sessionId.slice(0, 8)}…</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t("payment.orderId")}</Text>
          <Text style={styles.valueMono}>{paymentId}</Text>
        </View>
        {razorpayOrderId ? (
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.razorpayOrderId")}</Text>
            <Text style={styles.valueMono}>{razorpayOrderId}</Text>
          </View>
        ) : null}
        {razorpayPaymentId ? (
          <View style={styles.row}>
            <Text style={styles.label}>{t("payment.razorpayPaymentId")}</Text>
            <Text style={styles.valueMono}>{razorpayPaymentId}</Text>
          </View>
        ) : null}

        {paid ? (
          <Text style={styles.success}>{t("session.paymentCompleted")}</Text>
        ) : status === "cancelled" ? (
          <Text style={styles.pending}>{t("razorpay.paymentCancelled")}</Text>
        ) : status === "failed" ? (
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
          <Text style={styles.pending}>{t("razorpay.verificationPending")}</Text>
        )}

        {!gatewayConfigured ? <Text style={styles.gateway}>{t(gatewayMessageKey)}</Text> : null}
        {resolvedReceipt ? (
          <Text style={styles.pending}>
            {t("receipt.number", { number: resolvedReceipt })}
          </Text>
        ) : null}
      </AppCard>

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
        title={t("session.backToSessionPayment")}
        onPress={() =>
          navigation.navigate("SessionSummary", {
            sessionId,
            focusPayment: !paid,
          })
        }
        variant="outline"
        style={styles.btn}
      />
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
