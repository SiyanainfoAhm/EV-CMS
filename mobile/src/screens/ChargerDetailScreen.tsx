import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as chargerService from "../services/chargerService";
import type { Charger, ChargerConnector } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "ChargerDetail">;

export default function ChargerDetailScreen({ navigation, route }: Props) {
  const [charger, setCharger] = useState<Charger | undefined>();
  const [selected, setSelected] = useState<ChargerConnector | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    chargerService
      .getChargerById(route.params.id)
      .then((c) => {
        setCharger(c);
        const firstAvailable = c?.connectors.find((conn) => chargerService.isConnectorAvailable(conn.status));
        setSelected(firstAvailable);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load charger"));
  }, [route.params.id]);

  const startQr = () => {
    if (!charger) return;
    if (!selected) {
      Alert.alert("No connector", "Select an available connector to start charging.");
      return;
    }
    if (!chargerService.isConnectorAvailable(selected.status)) {
      Alert.alert("Unavailable", `Connector status: ${selected.status}`);
      return;
    }
    navigation.navigate("QRStart", { chargerId: charger.id, connectorId: selected.connectorId });
  };

  if (!charger && !error) return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={charger?.name ?? "Charger"} onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {charger ? (
        <>
          <AppCard>
            <View style={styles.row}>
              <Text style={styles.label}>Status</Text>
              <StatusBadge status={charger.status} />
            </View>
            <Text style={styles.meta}>{charger.location}</Text>
            <Text style={styles.meta}>
              {charger.chargePointId} · {charger.type} · {charger.maxPowerKw} kW max
            </Text>
          </AppCard>
          <Text style={styles.section}>Connectors</Text>
          {charger.connectors.map((conn) => {
            const available = chargerService.isConnectorAvailable(conn.status);
            const isSelected = selected?.id === conn.id;
            return (
              <Pressable key={conn.id} onPress={() => available && setSelected(conn)} disabled={!available}>
                <AppCard style={[styles.connector, isSelected && styles.connectorSelected]}>
                  <View>
                    <Text style={styles.connTitle}>
                      Gun {conn.connectorId} · {conn.type}
                    </Text>
                    <Text style={styles.connMeta}>{conn.maxPowerKw} kW</Text>
                  </View>
                  <StatusBadge status={conn.status} />
                </AppCard>
              </Pressable>
            );
          })}
          <AppButton title="Start with QR" onPress={startQr} style={styles.button} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontWeight: "600", color: colors.text },
  meta: { color: colors.textMuted, marginTop: 8, fontSize: 14 },
  section: { fontWeight: "600", marginVertical: spacing.md, color: colors.text },
  connector: { marginBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  connectorSelected: { borderWidth: 2, borderColor: colors.emerald },
  connTitle: { fontWeight: "500", color: colors.text },
  connMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  button: { marginTop: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
