import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Pressable, RefreshControl } from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import ChargePricePrompt, { type PrepaidPlanResult } from "../components/ChargePricePrompt";
import * as chargerService from "../services/chargerService";
import * as paymentService from "../services/paymentService";
import * as tariffService from "../services/tariffService";
import type { ActiveTariff } from "../services/tariffService";
import { useAuth } from "../context/AuthContext";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import { isMobileEndUser } from "../utils/rfpRoles";
import { formatHeartbeatAgo } from "../utils/chargerConnectivity";
import { showChargingErrorAlert } from "../utils/chargingErrors";
import { formatCurrency } from "../utils/format";
import {
  translateChargerLocation,
  translateChargerName,
  translateChargerType,
} from "../utils/translateRecord";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import type { Charger, ChargerConnector } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "ChargerDetail">;

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={fieldStyles.row}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={fieldStyles.valueWrap}>{children}</View>
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  label: { fontWeight: "600", color: colors.text, flex: 1 },
  valueWrap: { flex: 1.2, alignItems: "flex-end" },
});

export default function ChargerDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCharge = user ? isMobileEndUser(user.role) : false;
  const [charger, setCharger] = useState<Charger | undefined>();
  const [selected, setSelected] = useState<ChargerConnector | undefined>();
  const [busyConnectors, setBusyConnectors] = useState<Set<number>>(new Set());
  const [tariff, setTariff] = useState<ActiveTariff | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pricePromptVisible, setPricePromptVisible] = useState(false);

  const applyCharger = useCallback((c: Charger | undefined, busyIds: Set<number>) => {
    setCharger(c);
    setBusyConnectors(busyIds);
    if (!c) return;
    const sorted = [...c.connectors].sort((a, b) => a.connectorId - b.connectorId);
    const firstStartable = sorted.find((conn) =>
      chargerService.canStartOnConnector(conn.status, busyIds.has(conn.connectorId))
    );
    setSelected((prev) => {
      if (prev) {
        const stillThere = sorted.find((x) => x.id === prev.id);
        if (stillThere) return stillThere;
      }
      return firstStartable ?? sorted[0];
    });
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const c = await chargerService.getChargerById(route.params.id);
      const busyIds = c ? await chargerService.getBusyConnectorIds(c.id) : new Set<number>();
      applyCharger(c, busyIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("charger.loadFailed"));
    }
  }, [route.params.id, t, applyCharger]);

  useEffect(() => {
    void load();
    tariffService.getActiveChargingTariff().then(setTariff).catch(() => setTariff(null));
  }, [load]);

  useSupabaseRealtime(load);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openPricePrompt = () => {
    if (!charger || !user) return;
    if (!chargerService.canStartCharging(charger)) {
      Alert.alert(t("common.error"), t(chargerService.getChargerUnavailableMessageKey(charger)));
      return;
    }
    if (!selected) {
      Alert.alert(t("common.error"), t("charger.selectConnector"));
      return;
    }
    const gunBusy = busyConnectors.has(selected.connectorId);
    if (
      charger.connectors.length > 0 &&
      !chargerService.canStartOnConnector(selected.status, gunBusy)
    ) {
      Alert.alert(
        t("common.error"),
        t(chargerService.getConnectorBlockMessageKey(selected.status, gunBusy))
      );
      return;
    }
    setPricePromptVisible(true);
  };

  const startCharging = async (result: PrepaidPlanResult) => {
    if (!charger || !user || !selected) return;
    if (!chargerService.canStartCharging(charger)) {
      setPricePromptVisible(false);
      Alert.alert(t("common.error"), t("charger.cannotStartNotOnline"));
      return;
    }
    setPricePromptVisible(false);
    setBusy(true);
    try {
      await paymentService.createRazorpaySessionPayment({
        chargerId: charger.id,
        connectorId: selected.connectorId,
        userId: user.id,
        calculation: result.calculation,
        paymentPayload: result.paymentPayload,
        tariffId: tariff?.id ?? charger.tariffId ?? undefined,
      });
      navigation.navigate("LiveSession");
    } catch (e) {
      const message = e instanceof Error ? e.message : t("charger.startFailed");
      if (/Payment cancelled/i.test(message)) {
        Alert.alert(t("common.error"), t("prepaid.paymentCancelled"));
      } else if (/not online/i.test(message)) {
        Alert.alert(t("common.error"), t("charger.cannotStartNotOnline"));
      } else if (/already has an active session|already in use/i.test(message)) {
        Alert.alert(t("common.error"), t("charger.gunInUse"));
        void load();
      } else if (/Bind an active RFID|RFID card/i.test(message)) {
        showChargingErrorAlert(e, t, navigation);
      } else if (/Payment failed|Unable to create payment order/i.test(message)) {
        Alert.alert(t("common.error"), t("prepaid.paymentFailed"));
      } else if (/Session could not be started/i.test(message)) {
        Alert.alert(t("common.error"), t("prepaid.sessionStartFailed"));
      } else {
        showChargingErrorAlert(e, t, navigation);
      }
    } finally {
      setBusy(false);
    }
  };

  const startQr = () => {
    if (!charger) return;
    if (!chargerService.canStartCharging(charger)) {
      Alert.alert(t("common.error"), t(chargerService.getChargerUnavailableMessageKey(charger)));
      return;
    }
    if (!selected) {
      Alert.alert(t("common.error"), t("charger.selectConnector"));
      return;
    }
    navigation.navigate("QRStart", { chargerId: charger.id, connectorId: selected.connectorId });
  };

  if (!charger && !error) return null;

  const chargeable = charger ? chargerService.canStartCharging(charger) : false;
  const selectedBusy = selected ? busyConnectors.has(selected.connectorId) : false;
  const selectedStartable = selected
    ? chargerService.canStartOnConnector(selected.status, selectedBusy)
    : charger?.connectors.length === 0;
  const canStart = chargeable && Boolean(selectedStartable);
  const displayName = charger
    ? translateChargerName(t, charger.chargePointId, charger.name)
    : t("charger.detailTitle");
  const displayLocation = charger
    ? translateChargerLocation(t, charger.chargePointId, charger.location)
    : "";
  const manufacturerModel = charger
    ? [charger.manufacturer, charger.model].filter(Boolean).join(" · ")
    : "";
  const sortedConnectors = charger
    ? [...charger.connectors].sort((a, b) => a.connectorId - b.connectorId)
    : [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
      }
    >
      <Header title={displayName} onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {charger ? (
        <>
          <AppCard>
            <FieldRow label={t("charger.headers.name")}>
              <Text style={styles.value}>{displayName}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.chargePointId")}>
              <Text style={styles.value}>{charger.chargePointId}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.status")}>
              <View style={{ alignItems: "flex-end" }}>
                <StatusBadge status={charger.status || "unknown"} />
                {!chargeable ? (
                  <Text style={styles.unavailableNote}>{t("charger.chargingUnavailable")}</Text>
                ) : null}
              </View>
            </FieldRow>
            {charger.isSimulated ? (
              <FieldRow label={t("charger.simulatedBadge")}>
                <Text style={styles.sim}>{t("common.yes", { defaultValue: "Yes" })}</Text>
              </FieldRow>
            ) : null}
            <FieldRow label={t("charger.headers.location")}>
              <Text style={styles.value}>{displayLocation || "—"}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.chargerType")}>
              <Text style={styles.value}>{translateChargerType(t, charger.type)}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.maxPowerKw")}>
              <Text style={styles.value}>{t("charger.powerMax", { kw: charger.maxPowerKw || "—" })}</Text>
            </FieldRow>
            {manufacturerModel ? (
              <FieldRow label={t("charger.headers.manufacturer")}>
                <Text style={styles.value}>{manufacturerModel}</Text>
              </FieldRow>
            ) : null}
            {tariff ? (
              <FieldRow label={t("chargePrice.todaysRate")}>
                <Text style={styles.rateHighlight}>
                  {formatCurrency(tariff.ratePerKwh)}/kWh
                </Text>
              </FieldRow>
            ) : null}
            <FieldRow label={t("charger.headers.lastHeartbeat")}>
              <Text style={styles.value}>{formatHeartbeatAgo(charger.lastHeartbeat)}</Text>
            </FieldRow>
          </AppCard>
          <Text style={styles.section}>{t("charger.selectConnector")}</Text>
          {sortedConnectors.length === 0 ? (
            <Text style={styles.meta}>{t("charger.noConnectors")}</Text>
          ) : (
            sortedConnectors.map((conn) => {
              const isSelected = selected?.id === conn.id;
              const gunBusy = busyConnectors.has(conn.connectorId);
              const startable = chargerService.canStartOnConnector(conn.status, gunBusy);
              return (
                <Pressable key={conn.id} onPress={() => setSelected(conn)}>
                  <AppCard
                    style={[
                      styles.connector,
                      isSelected && styles.connectorSelected,
                      !startable && styles.connectorDisabled,
                    ]}
                  >
                    <View>
                      <Text style={styles.connTitle}>
                        {t("charger.connector", { id: conn.connectorId, type: conn.type })}
                      </Text>
                      <Text style={styles.connMeta}>{t("charger.power", { kw: conn.maxPowerKw })}</Text>
                      {!startable ? (
                        <Text style={styles.connUnavailable}>
                          {t(chargerService.getConnectorBlockMessageKey(conn.status, gunBusy))}
                        </Text>
                      ) : null}
                    </View>
                    <StatusBadge
                      status={gunBusy && !/charging/i.test(conn.status) ? "charging" : conn.status}
                    />
                  </AppCard>
                </Pressable>
              );
            })
          )}
          {!canCharge ? <AdminNoticeBanner /> : null}
          {canCharge ? (
            <>
              {!chargeable ? (
                <Text style={styles.unavailableBanner}>
                  {t(chargerService.getChargerUnavailableMessageKey(charger))}
                </Text>
              ) : null}
              <AppButton
                title={t("charger.startCharging")}
                onPress={openPricePrompt}
                loading={busy}
                disabled={!canStart}
                style={styles.button}
              />
              <AppButton
                title={t("charger.startWithQr")}
                onPress={startQr}
                variant="outline"
                disabled={!canStart}
                style={styles.button}
              />
              {!chargeable ? (
                <Text style={styles.unavailableNote}>{t("charger.chargingUnavailable")}</Text>
              ) : !selectedStartable ? (
                <Text style={styles.unavailableNote}>
                  {t(
                    chargerService.getConnectorBlockMessageKey(selected?.status, selectedBusy)
                  )}
                </Text>
              ) : null}
            </>
          ) : null}
          <ChargePricePrompt
            visible={pricePromptVisible && canStart}
            charger={charger}
            onCancel={() => setPricePromptVisible(false)}
            onConfirm={startCharging}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  value: { color: colors.textMuted, fontSize: 14, textAlign: "right" },
  sim: { color: "#92400e", fontWeight: "700", fontSize: 13 },
  rateHighlight: { color: colors.emerald, fontSize: 16, fontWeight: "700", textAlign: "right" },
  section: { fontWeight: "600", marginVertical: spacing.md, color: colors.text },
  meta: { color: colors.textMuted, marginBottom: spacing.sm },
  connector: {
    marginBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  connectorSelected: { borderWidth: 2, borderColor: colors.emerald },
  connectorDisabled: { opacity: 0.55 },
  connTitle: { fontWeight: "500", color: colors.text },
  connMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  connUnavailable: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "600",
    color: colors.danger,
  },
  button: { marginTop: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
  unavailableNote: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "600",
    color: colors.danger,
    textAlign: "right",
  },
  unavailableBanner: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: "#fef2f2",
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
});
