import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import ChargerCard from "../components/ChargerCard";
import * as chargerService from "../services/chargerService";
import SimulationModeBadge from "../components/SimulationModeBadge";
import { isSimulationEnabled } from "../utils/simulationMode";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import type { Charger, ChargerStatusFilter } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Chargers">;

const STATUS_FILTERS: ChargerStatusFilter[] = ["all", "online", "offline", "faulted"];

const FILTER_KEYS: Record<ChargerStatusFilter, string> = {
  all: "charger.filterAll",
  online: "status.online",
  offline: "status.offline",
  faulted: "status.faulted",
};

export default function ChargerListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [allChargers, setAllChargers] = useState<Charger[]>([]);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ChargerStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Broad fetch — do not filter by availableOnly / is_simulated / tariff.
      const data = await chargerService.fetchChargers(search);
      setAllChargers(data);
      if (data.length === 0) {
        setError(t("charger.noneAvailable"));
      }
    } catch (e) {
      setAllChargers([]);
      setError(e instanceof Error ? e.message : t("charger.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setChargers(chargerService.filterChargers(allChargers, status));
  }, [status, allChargers]);

  useSupabaseRealtime(load);

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
      <Header title={t("charger.listTitle")} subtitle={t("charger.listSubtitle")} onBack={() => navigation.goBack()} />
      {/* Simulation Mode is informational only — it must not hide chargers */}
      {isSimulationEnabled() ? <SimulationModeBadge compact /> : null}
      <TextInput
        style={styles.search}
        placeholder={t("charger.search")}
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
      />
      <View style={styles.filters}>
        {STATUS_FILTERS.map((s) => (
          <Pressable key={s} style={[styles.chip, status === s && styles.chipActive]} onPress={() => setStatus(s)}>
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>
              {t(FILTER_KEYS[s])}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.emerald} /> : null}
      {error && !loading ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && chargers.length === 0 && allChargers.length > 0 ? (
        <Text style={styles.empty}>{t("charger.noResults")}</Text>
      ) : null}
      {chargers.map((c) => (
        <ChargerCard
          key={c.id}
          charger={c}
          onPress={() => {
            navigation.navigate("ChargerDetail", { id: c.id });
            if (!chargerService.canStartCharging(c)) {
              Alert.alert(t("common.error"), t(chargerService.getChargerUnavailableMessageKey(c)));
            }
          }}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 15,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.emeraldMuted, borderColor: colors.emerald },
  chipText: { fontSize: 12, color: colors.textMuted, textTransform: "capitalize" },
  chipTextActive: { color: colors.emerald, fontWeight: "600" },
  error: { color: colors.danger, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
});
