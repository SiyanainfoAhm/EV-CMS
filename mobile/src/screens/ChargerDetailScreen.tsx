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
import * as chargerService from "../services/chargerService";
import * as chargingService from "../services/chargingService";
import { useAuth } from "../context/AuthContext";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import { isMobileEndUser } from "../utils/rfpRoles";
import { formatHeartbeatAgo } from "../utils/chargerConnectivity";
import { showChargingErrorAlert } from "../utils/chargingErrors";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    chargerService
      .getChargerById(route.params.id)
      .then((c) => {
        setCharger(c);
        const firstAvailable = c?.connectors.find((conn) => chargerService.isConnectorAvailable(conn.status));
        setSelected(firstAvailable);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("common.error")));
  }, [route.params.id, t]);

  const startCharging = async () => {
    if (!charger || !user || !selected) return;
    if (!chargerService.isConnectorAvailable(selected.status)) {
      Alert.alert(t("common.error"), t("charger.notAvailable"));
      return;
    }
    setBusy(true);
    try {
      await chargingService.startCharging(charger.id, selected.connectorId, user.id);
      navigation.navigate("LiveSession");
    } catch (e) {
      showChargingErrorAlert(e, t, navigation);
    } finally {
      setBusy(false);
    }
  };

  const startQr = () => {
    if (!charger) return;
    if (!selected) {
      Alert.alert(t("common.error"), t("charger.selectConnector"));
      return;
    }
    if (!chargerService.isConnectorAvailable(selected.status)) {
      Alert.alert(t("common.error"), t("charger.notAvailable"));
      return;
    }
    navigation.navigate("QRStart", { chargerId: charger.id, connectorId: selected.connectorId });
  };

  if (!charger && !error) return null;

  const displayName = charger
    ? translateChargerName(t, charger.chargePointId, charger.name)
    : t("charger.detailTitle");
  const displayLocation = charger
    ? translateChargerLocation(t, charger.chargePointId, charger.location)
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
            <FieldRow label={t("charger.headers.status")}>
              <StatusBadge status={charger.status} />
            </FieldRow>
            <FieldRow label={t("charger.headers.location")}>
              <Text style={styles.value}>{displayLocation}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.chargePointId")}>
              <Text style={styles.value}>{charger.chargePointId}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.chargerType")}>
              <Text style={styles.value}>{translateChargerType(t, charger.type)}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.maxPowerKw")}>
              <Text style={styles.value}>{t("charger.powerMax", { kw: charger.maxPowerKw })}</Text>
            </FieldRow>
            <FieldRow label={t("charger.headers.lastHeartbeat")}>
              <Text style={styles.value}>{formatHeartbeatAgo(charger.lastHeartbeat)}</Text>
            </FieldRow>
          </AppCard>
          <Text style={styles.section}>{t("charger.selectConnector")}</Text>
          {charger.connectors
            .filter((conn) => chargerService.isConnectorAvailable(conn.status))
            .map((conn) => {
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
          })}
          {charger.connectors.every((conn) => !chargerService.isConnectorAvailable(conn.status)) ? (
            <Text style={styles.error}>{t("charger.notAvailable")}</Text>
          ) : null}
          {!canCharge ? <AdminNoticeBanner /> : null}
          {canCharge ? (
            <>
              <AppButton title={t("charger.startCharging")} onPress={startCharging} loading={busy} style={styles.button} />
              <AppButton title={t("charger.startWithQr")} onPress={startQr} variant="outline" style={styles.button} />
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  value: { color: colors.textMuted, fontSize: 14, textAlign: "right" },
  section: { fontWeight: "600", marginVertical: spacing.md, color: colors.text },
  connector: { marginBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  connectorSelected: { borderWidth: 2, borderColor: colors.emerald },
  connTitle: { fontWeight: "500", color: colors.text },
  connMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  button: { marginTop: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
