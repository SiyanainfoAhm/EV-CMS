import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import * as walletService from "../services/walletService";
import { formatINR } from "../utils/currency";
import type { WalletLedgerEntry } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "WalletTransactions">;

const FILTERS = ["all", "credit", "debit", "hold"] as const;
const FILTER_KEYS: Record<(typeof FILTERS)[number], string> = {
  all: "wallet.filterAll",
  credit: "wallet.filterCredits",
  debit: "wallet.filterDebits",
  hold: "wallet.filterHolds",
};

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

export default function WalletTransactionHistoryScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<WalletLedgerEntry[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setEntries(await walletService.getWalletLedger({ filter, limit: 100 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [filter, t]);

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
      <Header title={t("wallet.transactionHistory")} onBack={() => navigation.goBack()} />

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{t(FILTER_KEYS[f])}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {entries.length === 0 && !error ? <Text style={styles.empty}>{t("wallet.noTransactions")}</Text> : null}

      {entries.map((entry) => (
        <AppCard key={entry.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.type}>{ledgerTypeLabel(t, entry.transactionType)}</Text>
            <Text style={styles.amount}>{formatINR(entry.amount)}</Text>
          </View>
          <Text style={styles.meta}>
            {t("ledger.type")}: {ledgerTypeLabel(t, entry.transactionType)} · {t("ledger.reference")}:{" "}
            {referenceLabel(t, entry.referenceType)}
          </Text>
          <Text style={styles.meta}>
            {t("ledger.balanceAfter")}: {formatINR(entry.balanceAfter)}
          </Text>
          {entry.remarks ? <Text style={styles.remarks}>{entry.remarks}</Text> : null}
          <Text style={styles.date}>{new Date(entry.createdAt).toLocaleString()}</Text>
        </AppCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.emeraldMuted, borderColor: colors.emerald },
  chipText: { fontSize: 12, color: colors.textMuted },
  chipTextActive: { color: colors.emerald, fontWeight: "600" },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  type: { fontWeight: "700", color: colors.text },
  amount: { fontWeight: "700", color: colors.emerald },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  remarks: { fontSize: 13, color: colors.text, marginTop: 6 },
  date: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
