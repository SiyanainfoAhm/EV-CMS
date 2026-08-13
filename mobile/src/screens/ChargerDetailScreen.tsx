import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Pressable,
  TextInput,
  RefreshControl,
} from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppButton from "../components/AppButton";
import StationChargerBlock from "../components/StationChargerBlock";
import ChargePricePrompt, { type PrepaidPlanResult } from "../components/ChargePricePrompt";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import * as chargerService from "../services/chargerService";
import * as chargingService from "../services/chargingService";
import * as tariffService from "../services/tariffService";
import { useAuth } from "../context/AuthContext";
import { isMobileEndUser } from "../utils/rfpRoles";
import { showChargingErrorAlert } from "../utils/chargingErrors";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import {
  chargerKindLabel,
  defaultDisplayRate,
  isConnectorSelectable,
  isDcCharger,
  stationTitleFromChargers,
} from "../utils/dfccilDisplay";
import type { Charger, ChargerConnector } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "ChargerDetail">;
type StationTab = "charger" | "details" | "reviews";
type QuickFilter = "available" | "ac" | "dc";

export default function ChargerDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCharge = user ? isMobileEndUser(user.role) : false;

  const [chargers, setChargers] = useState<Charger[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [busyByCharger, setBusyByCharger] = useState<Record<string, Set<number>>>({});
  const [selected, setSelected] = useState<{ charger: Charger; connector: ChargerConnector } | null>(
    null
  );
  const [tab, setTab] = useState<StationTab>("charger");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Set<QuickFilter>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [limitPromptVisible, setLimitPromptVisible] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const primary = await chargerService.getChargerById(route.params.id);
      if (!primary) {
        setChargers([]);
        setError(t("charger.loadFailed"));
        return;
      }

      const all = await chargerService.fetchChargers();
      const locationKey = String(primary.location || "").trim().toLowerCase();
      const siblings = locationKey
        ? all.filter((c) => String(c.location || "").trim().toLowerCase() === locationKey)
        : [primary];
      const list = siblings.length > 0 ? siblings : [primary];
      setChargers(list);

      const busyEntries = await Promise.all(
        list.map(async (c) => [c.id, await chargerService.getBusyConnectorIds(c.id)] as const)
      );
      setBusyByCharger(Object.fromEntries(busyEntries));

      const rateEntries = await Promise.all(
        list.map(async (c) => {
          try {
            const tariff = await tariffService.getTariffForCharger(c);
            return [c.id, tariff.ratePerKwh] as const;
          } catch {
            return [c.id, defaultDisplayRate(c)] as const;
          }
        })
      );
      setRates(Object.fromEntries(rateEntries));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("charger.loadFailed"));
    }
  }, [route.params.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useSupabaseRealtime(load);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleFilter = (f: QuickFilter) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const filteredChargers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return chargers.filter((c) => {
      if (q) {
        const blob = `${c.name} ${c.chargePointId} ${c.location}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (filters.has("ac") && isDcCharger(c)) return false;
      if (filters.has("dc") && !isDcCharger(c)) return false;
      if (filters.has("available")) {
        const busy = busyByCharger[c.id] ?? new Set();
        const hasAvailable = c.connectors.some(
          (conn) => isConnectorSelectable(conn.status) && !busy.has(conn.connectorId)
        );
        if (!hasAvailable) return false;
      }
      return true;
    });
  }, [chargers, search, filters, busyByCharger]);

  const acIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let ac = 0;
    let dc = 0;
    for (const c of chargers) {
      if (isDcCharger(c)) {
        dc += 1;
        map.set(c.id, dc);
      } else {
        ac += 1;
        map.set(c.id, ac);
      }
    }
    return map;
  }, [chargers]);

  const openSessionLimitPrompt = () => {
    if (!selected) {
      Alert.alert(t("common.error"), t("charger.selectConnector"));
      return;
    }
    if (!chargerService.canStartCharging(selected.charger)) {
      Alert.alert(t("common.error"), t(chargerService.getChargerUnavailableMessageKey(selected.charger)));
      return;
    }
    const busy = busyByCharger[selected.charger.id]?.has(selected.connector.connectorId) ?? false;
    if (!chargerService.canStartOnConnector(selected.connector.status, busy)) {
      Alert.alert(
        t("common.error"),
        t(chargerService.getConnectorBlockMessageKey(selected.connector.status, busy))
      );
      return;
    }
    const gunStatus = String(selected.connector.status || "")
      .toLowerCase()
      .trim();
    if (gunStatus === "available") {
      Alert.alert(
        t("charger.plugCableTitle", { defaultValue: "Plug in the cable" }),
        t("charger.plugCableBody", {
          defaultValue:
            "Connect the cable to your vehicle and wait until this gun shows Preparing, then continue.",
        })
      );
      return;
    }
    setLimitPromptVisible(true);
  };

  const startCharging = async (result: PrepaidPlanResult) => {
    if (!selected || !user) return;
    setLimitPromptVisible(false);
    setBusy(true);
    try {
      await chargingService.startChargingWithSessionLimit({
        chargerId: selected.charger.id,
        connectorId: selected.connector.connectorId,
        userId: user.id,
        mode: result.mode,
        prepaidValue: result.selectedValue,
        calculation: result.calculation,
        tariff: result.tariff,
        planId: result.plan?.id ?? null,
      });
      navigation.navigate("LiveSession");
    } catch (e) {
      const message = e instanceof Error ? e.message : t("charger.startFailed");
      if (/not online/i.test(message)) {
        Alert.alert(t("common.error"), t("charger.cannotStartNotOnline"));
      } else if (/already has an active session|already in use/i.test(message)) {
        Alert.alert(t("common.error"), t("charger.gunInUse"));
        void load();
      } else if (/Bind an active RFID|RFID card/i.test(message)) {
        showChargingErrorAlert(e, t, navigation);
      } else {
        showChargingErrorAlert(e, t, navigation);
      }
    } finally {
      setBusy(false);
    }
  };

  const title = stationTitleFromChargers(chargers);
  const address = chargers[0]?.location || "—";
  const ctaEnabled = Boolean(selected) && canCharge && !busy;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
      >
        <Header title={title} onBack={() => navigation.goBack()} />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.hero}>
          <Text style={styles.stationTitle}>{title}</Text>
          <Text style={styles.address}>{address}</Text>
          <View style={styles.chipRow}>
            <View style={[styles.infoChip, styles.infoChipGreen]}>
              <Text style={styles.infoChipTextGreen}>Open Now</Text>
            </View>
            <View style={styles.infoChip}>
              <Text style={styles.infoChipText}>24 Hours</Text>
            </View>
            <View style={styles.infoChip}>
              <Text style={styles.infoChipText}>Public</Text>
            </View>
          </View>
        </View>

        <View style={styles.tabs}>
          {(["charger", "details", "reviews"] as StationTab[]).map((key) => (
            <Pressable
              key={key}
              style={[styles.tab, tab === key && styles.tabActive]}
              onPress={() => setTab(key)}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
                {key === "charger" ? "Charger" : key === "details" ? "Details" : "Reviews"}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "charger" ? (
          <>
            <TextInput
              style={styles.search}
              placeholder="Search Charger Name"
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            <View style={styles.filterRow}>
              {(["available", "ac", "dc"] as QuickFilter[]).map((f) => {
                const active = filters.has(f);
                const label = f === "available" ? "Available" : f.toUpperCase();
                return (
                  <Pressable
                    key={f}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => toggleFilter(f)}
                  >
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {filteredChargers.map((c) => (
              <StationChargerBlock
                key={c.id}
                charger={c}
                displayIndex={acIndexMap.get(c.id)}
                ratePerKwh={rates[c.id] ?? defaultDisplayRate(c)}
                selectedConnectorId={selected?.connector.id}
                busyConnectorIds={busyByCharger[c.id]}
                onSelectConnector={(charger, connector) => setSelected({ charger, connector })}
              />
            ))}
            {filteredChargers.length === 0 ? (
              <Text style={styles.empty}>{t("charger.noResults")}</Text>
            ) : null}
          </>
        ) : null}

        {tab === "details" ? (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderTitle}>Station details</Text>
            <Text style={styles.placeholderBody}>
              Location: {address}
              {"\n"}
              Chargers at this station: {chargers.length}
              {"\n"}
              Types:{" "}
              {[...new Set(chargers.map((c) => chargerKindLabel(c)))].join(", ") || "—"}
            </Text>
          </View>
        ) : null}

        {tab === "reviews" ? (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderTitle}>Reviews</Text>
            <Text style={styles.placeholderBody}>
              Reviews are coming soon. Your charging feedback will appear here.
            </Text>
          </View>
        ) : null}

        {!canCharge ? <AdminNoticeBanner /> : null}
        <View style={{ height: 88 }} />
      </ScrollView>

      <View style={styles.stickyBar}>
        <AppButton
          title={selected ? t("charger.startCharging") : "Select a connector"}
          onPress={openSessionLimitPrompt}
          loading={busy}
          disabled={!ctaEnabled}
        />
      </View>

      <ChargePricePrompt
        visible={limitPromptVisible && Boolean(selected)}
        charger={selected?.charger ?? null}
        onCancel={() => setLimitPromptVisible(false)}
        onConfirm={startCharging}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  error: { color: colors.danger, marginBottom: spacing.sm },
  hero: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  stationTitle: { fontSize: 22, fontWeight: "800", color: colors.text },
  address: { marginTop: 6, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.md },
  infoChip: {
    backgroundColor: "#f3f4f6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  infoChipGreen: { backgroundColor: colors.emeraldMuted },
  infoChipText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  infoChipTextGreen: { fontSize: 11, fontWeight: "700", color: colors.emerald },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    marginBottom: spacing.md,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  tabActive: { backgroundColor: colors.emeraldMuted },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  tabTextActive: { color: colors.emerald },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    fontSize: 15,
    color: colors.text,
  },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.orangeMuted, borderColor: colors.orange },
  filterText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  filterTextActive: { color: colors.orange },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
  placeholderCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  placeholderTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  placeholderBody: { marginTop: 8, fontSize: 13, color: colors.textMuted, lineHeight: 20 },
  stickyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
