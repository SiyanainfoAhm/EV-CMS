import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Alert } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as sessionService from "../services/sessionService";
import * as chargerService from "../services/chargerService";
import { parseChargeQr } from "../utils/qrParser";
import { useAuth } from "../context/AuthContext";
import { isMobileEndUser } from "../utils/rfpRoles";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "QRStart">;

export default function QRStartScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const canCharge = user ? isMobileEndUser(user.role) : false;
  const defaultConnector = route.params.connectorId ?? 1;
  const [qrInput, setQrInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const resolveTarget = async () => {
    const parsed = parseChargeQr(qrInput);
    let chargerId = route.params.chargerId;
    let connectorId = defaultConnector;

    if (parsed) {
      connectorId = parsed.connectorId;
      if (parsed.chargerId) {
        chargerId = parsed.chargerId;
      } else if (parsed.chargePointId) {
        const charger = await chargerService.getChargerByChargePointId(parsed.chargePointId);
        if (!charger) throw new Error(`Unknown charger: ${parsed.chargePointId}`);
        chargerId = charger.id;
      }
    }

    return { chargerId, connectorId };
  };

  const start = async () => {
    setError("");
    setLoading(true);
    try {
      const { chargerId, connectorId } = await resolveTarget();
      await sessionService.startSession(chargerId, connectorId);
      navigation.replace("LiveSession");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start session";
      setError(msg);
      Alert.alert("Start failed", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <Header title="Scan QR Code" onBack={() => navigation.goBack()} />
      <AppCard style={styles.scanBox}>
        <View style={styles.qrPlaceholder}>
          <Text style={styles.qrText}>QR Scanner</Text>
          <Text style={styles.hint}>Camera scanner can be added later. Paste QR payload below.</Text>
        </View>
      </AppCard>
      <Text style={styles.label}>QR payload (JSON, evcms:// URL, or MP-DC-001:1)</Text>
      <TextInput
        style={styles.input}
        placeholder='e.g. {"chargerId":"...","connectorId":1}'
        placeholderTextColor={colors.textMuted}
        value={qrInput}
        onChangeText={setQrInput}
        autoCapitalize="none"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!canCharge ? (
        <AdminNoticeBanner />
      ) : (
        <>
          <Text style={styles.or}>
            Manual start · Gun {defaultConnector} on selected charger
          </Text>
          <AppButton title="Start Charging" onPress={start} loading={loading} style={styles.button} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  scanBox: { alignItems: "center", padding: spacing.xl, marginBottom: spacing.sm },
  qrPlaceholder: {
    width: 220,
    height: 160,
    borderWidth: 2,
    borderColor: colors.emerald,
    borderStyle: "dashed",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  qrText: { fontWeight: "700", fontSize: 18, color: colors.text },
  hint: { color: colors.textMuted, marginTop: 8, textAlign: "center", fontSize: 13 },
  label: { fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.card,
    fontSize: 14,
  },
  error: { color: colors.danger, marginTop: spacing.sm },
  or: { textAlign: "center", color: colors.textMuted, marginVertical: spacing.md, fontSize: 13 },
  button: { marginTop: spacing.sm },
});
