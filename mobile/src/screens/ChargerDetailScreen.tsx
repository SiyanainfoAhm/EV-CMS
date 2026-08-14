import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Pressable,
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
  buildChargerDisplayIndexMap,
  defaultDisplayRate,
  dfccilChargerDisplayName,
  isVisibleFleetCharger,
} from "../utils/dfccilDisplay";
import type { Charger, ChargerConnector } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "ChargerDetail">;
type DetailTab = "connectors" | "details";

/**
 * Connector selection for ONE selected charger.
 * Does not list sibling chargers — go back to Find Chargers to pick another.
 */
export default function ChargerDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCharge = user ? isMobileEndUser(user.role) : false;
  const chargerId = route.params.id;

  const [charger, setCharger] = useState<Charger | undefined>();
  const [displayIndex, setDisplayIndex] = useState<number | undefined>();
  const [ratePerKwh, setRatePerKwh] = useState(DEFAULT_FALLBACK_RATE);
  const [busyConnectors, setBusyConnectors] = useState<Set<number>>(new Set());
  const [selectedConnector, setSelectedConnector] = useState<ChargerConnector | null>(null);
  const [tab, setTab] = useState<DetailTab>("connectors");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [limitPromptVisible, setLimitPromptVisible] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const primary = await chargerService.getChargerById(chargerId);
      if (!primary || !isVisibleFleetCharger(primary)) {
        setCharger(undefined);
        setSelectedConnector(null);
        setError("Selected charger not found. Please go back and select a charger.");
        return;
      }

      // Site-scoped display number (same rules as list) — still only render THIS charger.
      const all = await chargerService.fetchChargers();
      const visible = all.filter(isVisibleFleetCharger);
      const indexMap = buildChargerDisplayIndexMap(visible);
      setDisplayIndex(indexMap.get(primary.id));

      setCharger(primary);
      const busyIds = await chargerService.getBusyConnectorIds(primary.id);
      setBusyConnectors(busyIds);

      try {
        const tariff = await tariffService.getTariffForCharger(primary);
        setRatePerKwh(tariff.ratePerKwh);
      } catch {
        setRatePerKwh(defaultDisplayRate(primary));
      }

      setSelectedConnector((prev) => {
        if (!prev) return null;
        const stillThere = primary.connectors.find((c) => c.id === prev.id);
        return stillThere ?? null;
      });
    } catch (e) {
      setCharger(undefined);
      setError(e instanceof Error ? e.message : t("charger.loadFailed"));
    }
  }, [chargerId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useSupabaseRealtime(load);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const title = useMemo(() => {
    if (!charger) return t("charger.detailTitle");
    return dfccilChargerDisplayName(charger, displayIndex);
  }, [charger, displayIndex, t]);

  const openSessionLimitPrompt = () => {
    if (!charger || !selectedConnector) {
      Alert.alert(t("common.error"), t("charger.selectConnector"));
      return;
    }
    if (!chargerService.canStartCharging(charger)) {
      Alert.alert(t("common.error"), t(chargerService.getChargerUnavailableMessageKey(charger)));
      return;
    }
    const gunBusy = busyConnectors.has(selectedConnector.connectorId);
    if (!chargerService.canStartOnConnector(selectedConnector.status, gunBusy)) {
      Alert.alert(
        t("common.error"),
        t(chargerService.getConnectorBlockMessageKey(selectedConnector.status, gunBusy))
      );
      return;
    }
    const gunStatus = String(selectedConnector.status || "")
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
    if (!charger || !selectedConnector || !user) return;
    setLimitPromptVisible(false);
    setBusy(true);
    try {
      await chargingService.startChargingWithSessionLimit({
        chargerId: charger.id,
        connectorId: selectedConnector.connectorId,
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
      } else if (/Amount limit is too low/i.test(message)) {
        Alert.alert(t("common.error"), message);
      } else {
        showChargingErrorAlert(e, t, navigation);
      }
    } finally {
      setBusy(false);
    }
  };

  const ctaEnabled = Boolean(charger && selectedConnector) && canCharge && !busy;

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

        {charger ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.stationTitle}>{title}</Text>
              <Text style={styles.address}>{charger.location || "—"}</Text>
              <Text style={styles.metaLine}>{charger.chargePointId}</Text>
              <View style={styles.chipRow}>
                <View
                  style={[
                    styles.infoChip,
                    chargerService.canStartCharging(charger)
                      ? styles.infoChipGreen
                      : styles.infoChipMuted,
                  ]}
                >
                  <Text
                    style={
                      chargerService.canStartCharging(charger)
                        ? styles.infoChipTextGreen
                        : styles.infoChipText
                    }
                  >
                    {String(charger.status || "unknown")}
                  </Text>
                </View>
                <View style={styles.infoChip}>
                  <Text style={styles.infoChipText}>
                    {charger.connectors.length} connector
                    {charger.connectors.length === 1 ? "" : "s"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.tabs}>
              {(["connectors", "details"] as DetailTab[]).map((key) => (
                <Pressable
                  key={key}
                  style={[styles.tab, tab === key && styles.tabActive]}
                  onPress={() => setTab(key)}
                >
                  <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
                    {key === "connectors" ? "Connectors" : "Details"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tab === "connectors" ? (
              <StationChargerBlock
                charger={charger}
                displayIndex={displayIndex}
                ratePerKwh={ratePerKwh}
                selectedConnectorId={selectedConnector?.id}
                busyConnectorIds={busyConnectors}
                onSelectConnector={(_c, connector) => setSelectedConnector(connector)}
              />
            ) : (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderTitle}>Charger details</Text>
                <Text style={styles.placeholderBody}>
                  Name: {title}
                  {"\n"}
                  Charge point: {charger.chargePointId}
                  {"\n"}
                  Type: {charger.type}
                  {"\n"}
                  Max power: {charger.maxPowerKw || "—"} kW
                  {"\n"}
                  Location: {charger.location || "—"}
                </Text>
              </View>
            )}

            {!canCharge ? <AdminNoticeBanner /> : null}
          </>
        ) : !error ? (
          <Text style={styles.muted}>{t("common.loading")}</Text>
        ) : (
          <AppButton title={t("common.back")} onPress={() => navigation.goBack()} />
        )}

        <View style={{ height: 88 }} />
      </ScrollView>

      {charger ? (
        <View style={styles.stickyBar}>
          <AppButton
            title={selectedConnector ? t("charger.startCharging") : "Select a connector"}
            onPress={openSessionLimitPrompt}
            loading={busy}
            disabled={!ctaEnabled}
          />
        </View>
      ) : null}

      <ChargePricePrompt
        visible={limitPromptVisible && Boolean(charger && selectedConnector)}
        charger={charger ?? null}
        onCancel={() => setLimitPromptVisible(false)}
        onConfirm={startCharging}
      />
    </View>
  );
}

const DEFAULT_FALLBACK_RATE = 14.49;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  error: { color: colors.danger, marginBottom: spacing.sm, lineHeight: 20 },
  muted: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  hero: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  stationTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  address: { marginTop: 6, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  metaLine: { marginTop: 4, fontSize: 12, color: colors.textMuted },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.md },
  infoChip: {
    backgroundColor: "#f3f4f6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  infoChipGreen: { backgroundColor: colors.emeraldMuted },
  infoChipMuted: { backgroundColor: "#f3f4f6" },
  infoChipText: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "capitalize" },
  infoChipTextGreen: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.emerald,
    textTransform: "capitalize",
  },
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
