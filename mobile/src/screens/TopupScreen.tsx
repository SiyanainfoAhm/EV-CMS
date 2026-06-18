import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as paymentService from "../services/paymentService";
import { isRazorpayGateway } from "../config/paymentConfig";
import { TOPUP_MIN_AMOUNT, TOPUP_PAYMENT_METHODS, TOPUP_QUICK_AMOUNTS } from "../config/walletConfig";
import type { TopupPaymentMethod } from "../config/walletConfig";
import { parseAmountInput } from "../utils/currency";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Topup">;

const METHOD_LABEL_KEYS: Record<TopupPaymentMethod, string> = {
  upi: "topup.methodUpi",
  card: "topup.methodCard",
  netbanking: "topup.methodNetBanking",
  gateway: "topup.methodGateway",
};

export default function TopupScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const suggestedAmount = route.params?.suggestedAmount;
  const returnSessionId = route.params?.returnSessionId;
  const [amount, setAmount] = useState(suggestedAmount ? String(suggestedAmount) : "");
  const [method, setMethod] = useState<TopupPaymentMethod>("gateway");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const parsed = parseAmountInput(amount);
    if (parsed == null) {
      Alert.alert(t("common.error"), t("topup.amountRequired"));
      return;
    }
    if (parsed < TOPUP_MIN_AMOUNT) {
      Alert.alert(t("common.error"), t("topup.minimumAmount"));
      return;
    }

    if (!paymentService.checkGatewayConfigured()) {
      Alert.alert(t("common.error"), t("razorpay.gatewayNotConfigured"));
      return;
    }

    setLoading(true);
    try {
      if (paymentService.isRazorpayPaymentEnabled()) {
        const result = await paymentService.processRazorpayTopup(parsed);
        navigation.replace("TopupPaymentStatus", {
          paymentOrderId: result.paymentOrderId,
          returnSessionId,
          razorpayOrderId: result.razorpayOrderId,
          razorpayPaymentId: result.razorpayPaymentId,
          initialStatus: result.status,
          initialWalletCredited: result.walletCredited,
          initialMessage: result.cancelled
            ? t("razorpay.paymentCancelled")
            : result.errorMessage
              ? t("razorpay.paymentFailed")
              : result.walletCredited
                ? t("razorpay.verificationSuccess")
                : result.status === "paid"
                  ? t("razorpay.verificationSuccess")
                  : t("razorpay.verificationPending"),
        });
        return;
      }

      if (paymentService.isPaymentMockEnabled()) {
        const order = await paymentService.createTopupPaymentOrder(parsed, method);
        navigation.replace("TopupPaymentStatus", {
          paymentOrderId: order.paymentOrderId,
          returnSessionId,
          initialStatus: order.status,
          initialMessage: t("razorpay.verificationPending"),
        });
        return;
      }

      const order = await paymentService.createTopupPaymentOrder(parsed, method);
      await paymentService.startTopupPayment(order);
      navigation.replace("TopupPaymentStatus", {
        paymentOrderId: order.paymentOrderId,
        returnSessionId,
        initialStatus: order.status,
      });
    } catch (e) {
      const msg =
        e instanceof Error && e.message === "INVALID_AMOUNT"
          ? t("topup.invalidAmount")
          : e instanceof Error && e.message === "API_NOT_CONFIGURED"
            ? t("razorpay.gatewayNotConfigured")
            : e instanceof Error && e.message === "RAZORPAY_KEY_MISSING"
              ? t("razorpay.keyMissing")
              : e instanceof Error
                ? e.message
                : t("razorpay.orderCreateFailed");
      Alert.alert(t("common.error"), msg);
    } finally {
      setLoading(false);
    }
  };

  const gatewayReady = paymentService.checkGatewayConfigured();
  const razorpayReady = paymentService.isRazorpayPaymentEnabled();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={t("topup.title")} onBack={() => navigation.goBack()} />

      {suggestedAmount ? (
        <AppCard style={styles.contextCard}>
          <Text style={styles.contextTitle}>{t("topup.sessionPaymentContext")}</Text>
          <Text style={styles.contextBody}>
            {t("topup.suggestedAmount", { amount: suggestedAmount })}
          </Text>
        </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.label}>{t("topup.enterAmount")}</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="100"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.hint}>{t("topup.minimumAmount")}</Text>

        <Text style={[styles.label, { marginTop: spacing.md }]}>{t("topup.quickAmount")}</Text>
        <View style={styles.quickRow}>
          {TOPUP_QUICK_AMOUNTS.map((q) => (
            <Pressable key={q} style={styles.quickChip} onPress={() => setAmount(String(q))}>
              <Text style={styles.quickText}>₹{q}</Text>
            </Pressable>
          ))}
        </View>

        {!razorpayReady && !isRazorpayGateway() ? (
          <>
            <Text style={[styles.label, { marginTop: spacing.md }]}>{t("topup.paymentMethod")}</Text>
            {TOPUP_PAYMENT_METHODS.map((m) => (
              <Pressable
                key={m}
                style={[styles.methodRow, method === m && styles.methodActive]}
                onPress={() => setMethod(m)}
              >
                <Text style={[styles.methodText, method === m && styles.methodTextActive]}>
                  {t(METHOD_LABEL_KEYS[m])}
                </Text>
              </Pressable>
            ))}
          </>
        ) : (
          <Text style={[styles.hint, { marginTop: spacing.md }]}>{t("razorpay.title")}</Text>
        )}
      </AppCard>

      {!gatewayReady ? (
        <Text style={styles.gatewayNote}>{t(paymentService.getGatewayPendingMessage())}</Text>
      ) : razorpayReady ? (
        <Text style={styles.gatewayNote}>{t("razorpay.checkoutHint")}</Text>
      ) : paymentService.isPaymentMockEnabled() ? (
        <Text style={styles.gatewayNote}>{t("razorpay.verificationPending")}</Text>
      ) : isRazorpayGateway() ? (
        <Text style={styles.gatewayNote}>{t(paymentService.getGatewayPendingMessage())}</Text>
      ) : (
        <Text style={styles.gatewayNote}>{t("topup.waitingForGateway")}</Text>
      )}

      <AppButton
        title={t("topup.proceedToPayment")}
        onPress={submit}
        loading={loading}
        disabled={!gatewayReady}
        style={styles.btn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  label: { fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    fontSize: 18,
    backgroundColor: colors.card,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.emerald,
    backgroundColor: colors.emeraldMuted,
  },
  quickText: { fontWeight: "600", color: colors.emerald },
  methodRow: {
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  methodActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldMuted },
  methodText: { color: colors.text },
  methodTextActive: { fontWeight: "700", color: colors.emerald },
  gatewayNote: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm, textAlign: "center" },
  contextCard: { marginBottom: spacing.sm, backgroundColor: colors.emeraldMuted },
  contextTitle: { fontWeight: "700", color: colors.text, marginBottom: 6 },
  contextBody: { color: colors.textMuted, lineHeight: 20 },
  btn: { marginTop: spacing.md },
});
