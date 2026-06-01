import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as chargerService from "../services/chargerService";
import type { Charger } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "ChargerDetail">;

export default function ChargerDetailScreen({ navigation, route }: Props) {
  const [charger, setCharger] = useState<Charger | undefined>();

  useEffect(() => {
    chargerService.getChargerById(route.params.id).then(setCharger);
  }, [route.params.id]);

  if (!charger) return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={charger.name} onBack={() => navigation.goBack()} />
      <AppCard>
        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <StatusBadge status={charger.status} />
        </View>
        <Text style={styles.meta}>{charger.location}</Text>
        <Text style={styles.meta}>{charger.type} · {charger.maxPowerKw} kW max</Text>
      </AppCard>
      <Text style={styles.section}>Connectors</Text>
      {charger.connectors.map((conn) => (
        <AppCard key={conn.id} style={styles.connector}>
          <Text style={styles.connTitle}>Gun {conn.connectorId} · {conn.type}</Text>
          <StatusBadge status={conn.status} />
        </AppCard>
      ))}
      <AppButton title="Start with QR" onPress={() => navigation.navigate("QRStart", { chargerId: charger.id })} />
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
  connTitle: { fontWeight: "500", color: colors.text },
});
