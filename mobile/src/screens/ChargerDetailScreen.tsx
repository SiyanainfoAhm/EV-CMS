import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from "react-native";
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
  const [tariff, setTariff] = useState<ActiveTariff | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pricePromptVisible, setPricePromptVisible] = useState(false);

  useEffect(() => {
    chargerService
      .getChargerById(route.params.id)
      .then((c) => {
        setCharger(c);
        const firstAvailable = c?.connectors.find((conn) =>
          chargerService.isConnectorAvailable(conn.status)
        );
        setSelected(firstAvailable ?? c?.connectors[0]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("charger.loadFailed")));
    tariffService.getActiveChargingTariff().then(setTariff).catch(() => setTariff(null));
  }, [route.params.id, t]);

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
    if (
      charger.connectors.length > 0 &&
      !chargerService.isConnectorAvailable(selected.status)
    ) {
      Alert.alert(t("common.error"), t("charger.notAvailable"));
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
  const displayName = charger
    ? translateChargerName(t, charger.chargePointId, charger.name)
    : t("charger.detailTitle");
  const displayLocation = charger
    ? translateChargerLocation(t, charger.chargePointId, charger.location)
    : "";
  const manufacturerModel = charger
    ? [charger.manufacturer, charger.model].filter(Boolean).join(" · ")
    : "";

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
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
          {charger.connectors.length === 0 ? (
            <Text style={styles.meta}>{t("charger.noConnectors")}</Text>
          ) : (
            charger.connectors.map((conn) => {
              const isSelected = selected?.id === conn.id;
              return (
                <Pressable key={conn.id} onPress={() => setSelected(conn)}>
                  <AppCard style={[styles.connector, isSelected && styles.connectorSelected]}>
                    <View>
                      <Text style={styles.connTitle}>
                        {t("charger.connector", { id: conn.connectorId, type: conn.type })}
                      </Text>
                      <Text style={styles.connMeta}>{t("charger.power", { kw: conn.maxPowerKw })}</Text>
                    </View>
                    <StatusBadge status={conn.status} />
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
                disabled={!chargeable}
                style={styles.button}
              />
              <AppButton
                title={t("charger.startWithQr")}
                onPress={startQr}
                variant="outline"
                disabled={!chargeable}
                style={styles.button}
              />
              {!chargeable ? (
                <Text style={styles.unavailableNote}>{t("charger.chargingUnavailable")}</Text>
              ) : null}
            </>
          ) : null}
          <ChargePricePrompt
            visible={pricePromptVisible && chargeable}
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
  connTitle: { fontWeight: "500", color: colors.text },
  connMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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
