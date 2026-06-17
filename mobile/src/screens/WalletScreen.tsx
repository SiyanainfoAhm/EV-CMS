import { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as walletService from "../services/walletService";
import * as paymentService from "../services/paymentService";
import { formatINR } from "../utils/currency";
import type { WalletLedgerEntry, WalletSummary } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Wallet">;

function ledgerTypeLabel(t: (k: string) => string, type: string): string {
  return t(`ledger.${type}`);
}

function referenceLabel(t: (k: string) => string, ref: string): string {
  const map: Record<string, string> = {
    topup: "ledger.topup",
    payment_order: "ledger.paymentOrder",
    charging_session: "ledger.chargingSession",
    refund: "ledger.refund",
    admin_adjustment: "ledger.adminAdjustment",
    hold: "ledger.hold",
    release: "ledger.release",
  };
  return t(map[ref] ?? ref);
}

export default function WalletScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [recent, setRecent] = useState<WalletLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [s, ledger] = await Promise.all([
        walletService.refreshWallet(),
        walletService.getWalletLedger({ limit: 5 }),
      ]);
      setSummary(s);
      setRecent(ledger);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("wallet.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
    >
      <Header title={t("wallet.title")} onBack={() => navigation.goBack()} />

      {loading ? <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {summary ? (
        <AppCard>
          <Text style={styles.label}>{t("wallet.availableBalance")}</Text>
          <Text style={styles.balance}>{formatINR(summary.balanceAmount)}</Text>
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.subLabel}>{t("wallet.holdAmount")}</Text>
              <Text style={styles.subValue}>{formatINR(summary.holdAmount)}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.subLabel}>{t("wallet.usableBalance")}</Text>
              <Text style={styles.subValue}>{formatINR(summary.usableBalance)}</Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.subLabel}>{t("wallet.status")}</Text>
            <StatusBadge status={summary.status} />
          </View>
          <Text style={styles.currency}>
            {t("wallet.currency")}: {summary.currency}
          </Text>
        </AppCard>
      ) : null}

      {!paymentService.checkGatewayConfigured() ? (
        <AppCard style={styles.infoCard}>
          <Text style={styles.infoText}>{t("wallet.gatewayPending")}</Text>
          <Text style={styles.infoSub}>{t("wallet.infoText")}</Text>
        </AppCard>
      ) : (
        <AppCard style={styles.infoCard}>
          <Text style={styles.infoSub}>{t("wallet.infoText")}</Text>
        </AppCard>
      )}

      <AppButton title={t("wallet.topUp")} onPress={() => navigation.navigate("Topup")} style={styles.btn} />
      <AppButton
        title={t("wallet.viewTransactions")}
        onPress={() => navigation.navigate("WalletTransactions")}
        variant="outline"
        style={styles.btn}
      />
      <AppButton title={t("wallet.refreshBalance")} onPress={onRefresh} variant="outline" style={styles.btn} />

      <Text style={styles.section}>{t("wallet.recentTransactions")}</Text>
      {recent.length === 0 && !loading ? (
        <Text style={styles.empty}>{t("wallet.noTransactions")}</Text>
      ) : null}
      {recent.map((entry) => (
        <AppCard key={entry.id} style={styles.ledgerCard}>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerType}>{ledgerTypeLabel(t, entry.transactionType)}</Text>
            <Text style={styles.ledgerAmount}>{formatINR(entry.amount)}</Text>
          </View>
          <Text style={styles.ledgerMeta}>
            {referenceLabel(t, entry.referenceType)} · {t("ledger.balanceAfter")}:{" "}
            {formatINR(entry.balanceAfter)}
          </Text>
          <Text style={styles.ledgerDate}>{new Date(entry.createdAt).toLocaleString()}</Text>
        </AppCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  label: { color: colors.textMuted, fontSize: 13 },
  balance: { fontSize: 32, fontWeight: "800", color: colors.emerald, marginTop: 4 },
  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  col: { flex: 1 },
  subLabel: { fontSize: 12, color: colors.textMuted },
  subValue: { fontSize: 16, fontWeight: "600", color: colors.text, marginTop: 4 },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
  },
  currency: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted },
  infoCard: { backgroundColor: colors.emeraldMuted, marginTop: spacing.sm },
  infoText: { fontWeight: "600", color: colors.text, marginBottom: 6 },
  infoSub: { fontSize: 13, color: colors.textMuted, lineHeight: 20 },
  btn: { marginTop: spacing.sm },
  section: { fontWeight: "700", fontSize: 16, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.md },
  ledgerCard: { marginBottom: spacing.sm },
  ledgerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ledgerType: { fontWeight: "600", color: colors.text },
  ledgerAmount: { fontWeight: "700", color: colors.emerald },
  ledgerMeta: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  ledgerDate: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
