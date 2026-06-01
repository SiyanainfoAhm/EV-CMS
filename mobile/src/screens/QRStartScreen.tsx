import { View, Text, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as sessionService from "../services/sessionService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "QRStart">;

export default function QRStartScreen({ navigation, route }: Props) {
  const start = async () => {
    await sessionService.startSession(route.params.chargerId, 1);
    navigation.replace("LiveSession");
  };

  return (
    <View style={styles.root}>
      <Header title="Scan QR Code" onBack={() => navigation.goBack()} />
      <AppCard style={styles.scanBox}>
        <View style={styles.qrPlaceholder}>
          <Text style={styles.qrText}>QR Scanner</Text>
          <Text style={styles.hint}>Align charger QR code within frame</Text>
        </View>
      </AppCard>
      <Text style={styles.or}>or start manually (demo)</Text>
      <AppButton title="Start Charging" onPress={start} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  scanBox: { alignItems: "center", padding: spacing.xl },
  qrPlaceholder: {
    width: 220,
    height: 220,
    borderWidth: 2,
    borderColor: colors.emerald,
    borderStyle: "dashed",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  qrText: { fontWeight: "700", fontSize: 18, color: colors.text },
  hint: { color: colors.textMuted, marginTop: 8, textAlign: "center", fontSize: 13 },
  or: { textAlign: "center", color: colors.textMuted, marginVertical: spacing.md },
});
