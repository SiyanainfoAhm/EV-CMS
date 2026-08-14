import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  RefreshControl,
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
import {
  getChargerDisplayName,
  isConnectorSelectable,
  isDcCharger,
  isVisibleFleetCharger,
  logChargerFilter,
  summarizeVisibleChargers,
} from "../utils/dfccilDisplay";
import type { Charger, ChargerStatusFilter } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Chargers">;
type ExtraFilter = "available" | "ac" | "dc";

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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ChargerStatusFilter>("all");
  const [extra, setExtra] = useState<Set<ExtraFilter>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await chargerService.fetchChargers("");
      const visible = data.filter(isVisibleFleetCharger);
      setAllChargers(visible);
      logChargerFilter(data, visible);
      console.log("[charger-inventory]", summarizeVisibleChargers(visible));
      if (visible.length === 0) setError(t("charger.noneAvailable"));
    } catch (e) {
      setAllChargers([]);
      setError(e instanceof Error ? e.message : t("charger.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useSupabaseRealtime(load);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleExtra = (f: ExtraFilter) => {
    setExtra((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const chargers = useMemo(() => {
    let list = chargerService.filterChargers(allChargers, status);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        `${getChargerDisplayName(c)} ${c.name} ${c.displayName ?? ""} ${c.chargePointId} ${c.location}`
          .toLowerCase()
          .includes(q)
      );
    }
    if (extra.has("ac")) list = list.filter((c) => !isDcCharger(c));
    if (extra.has("dc")) list = list.filter((c) => isDcCharger(c));
    if (extra.has("available")) {
      list = list.filter(
        (c) =>
          chargerService.canStartCharging(c) &&
          c.connectors.some((conn) => isConnectorSelectable(conn.status))
      );
    }
    return list;
  }, [allChargers, status, search, extra]);

  const inventory = useMemo(() => summarizeVisibleChargers(allChargers), [allChargers]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
    >
      <Header title={t("charger.listTitle")} subtitle={t("charger.listSubtitle")} onBack={() => navigation.goBack()} />
      {isSimulationEnabled() ? <SimulationModeBadge compact /> : null}
      <Text style={styles.inventory}>
        Active {inventory.totalActive} · AC {inventory.activeAc} · DC {inventory.activeDc}
        {inventory.missingCoordinates > 0
          ? ` · ${inventory.missingCoordinates} missing map coords`
          : ""}
      </Text>
      <TextInput
        style={styles.search}
        placeholder="Search Charger Name"
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
      />
      <View style={styles.filters}>
        {STATUS_FILTERS.map((s) => (
          <Pressable key={s} style={[styles.chip, status === s && styles.chipActive]} onPress={() => setStatus(s)}>
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{t(FILTER_KEYS[s])}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.filters}>
        {(["available", "ac", "dc"] as ExtraFilter[]).map((f) => {
          const active = extra.has(f);
          return (
            <Pressable
              key={f}
              style={[styles.chip, active && styles.chipOrange]}
              onPress={() => toggleExtra(f)}
            >
              <Text style={[styles.chipText, active && styles.chipOrangeText]}>
                {f === "available" ? "Available" : f.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
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
          onPress={() => navigation.navigate("ChargerDetail", { id: c.id })}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  inventory: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontWeight: "600",
  },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 15,
    color: colors.text,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.emeraldMuted, borderColor: colors.emerald },
  chipOrange: { backgroundColor: colors.orangeMuted, borderColor: colors.orange },
  chipText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  chipTextActive: { color: colors.emerald },
  chipOrangeText: { color: colors.orange },
  error: { color: colors.danger, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
});
