import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View, Text, Pressable, ActivityIndicator } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import ChargerCard from "../components/ChargerCard";
import * as chargerService from "../services/chargerService";
import SimulationModeBadge from "../components/SimulationModeBadge";
import { isSimulationEnabled } from "../utils/simulationMode";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import type { Charger } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Chargers">;

const STATUS_FILTERS = ["all", "online", "offline", "faulted"] as const;

export default function ChargerListScreen({ navigation }: Props) {
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await chargerService.getChargers({
        status,
        search,
        onlineOnly: false,
      });
      setChargers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chargers");
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useSupabaseRealtime(load);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Chargers" subtitle="Live status from EV_Chargers" onBack={() => navigation.goBack()} />
      {isSimulationEnabled() ? <SimulationModeBadge compact /> : null}
      <TextInput
        style={styles.search}
        placeholder="Search name, ID, location..."
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
      />
      <View style={styles.filters}>
        {STATUS_FILTERS.map((s) => (
          <Pressable
            key={s}
            style={[styles.chip, status === s && styles.chipActive]}
            onPress={() => setStatus(s)}
          >
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.emerald} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && chargers.length === 0 ? (
        <Text style={styles.empty}>No chargers match your filters</Text>
      ) : null}
      {chargers.map((c) => (
        <ChargerCard key={c.id} charger={c} onPress={() => navigation.navigate("ChargerDetail", { id: c.id })} />
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
