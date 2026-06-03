import { useCallback, useState } from "react";
import { Text, ScrollView, StyleSheet, TextInput, Alert, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as rfidService from "../services/rfidService";
import type { RFIDCard } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "RFIDBinding">;

export default function RFIDBindingScreen({ navigation }: Props) {
  const [cards, setCards] = useState<RFIDCard[]>([]);
  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await rfidService.getUserRfidCards();
      setCards(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load RFID cards");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const bind = async () => {
    setLoading(true);
    try {
      await rfidService.bindRfid(uid);
      setUid("");
      await load();
      Alert.alert("Bound", "RFID card linked to your account");
    } catch (e) {
      Alert.alert("Bind failed", e instanceof Error ? e.message : "Could not bind RFID");
    } finally {
      setLoading(false);
    }
  };

  const unbind = (card: RFIDCard) => {
    Alert.alert("Unbind RFID", `Remove ${card.uid} from your account?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unbind",
        style: "destructive",
        onPress: async () => {
          try {
            await rfidService.unbindRfid(card.id);
            await load();
          } catch (e) {
            Alert.alert("Error", e instanceof Error ? e.message : "Unbind failed");
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="RFID Cards" onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cards.map((c) => (
        <AppCard key={c.id} style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.uid}>{c.uid}</Text>
            <StatusBadge status={c.status} />
          </View>
          <AppButton title="Unbind" onPress={() => unbind(c)} variant="outline" style={styles.smallButton} />
        </AppCard>
      ))}
      <Text style={styles.label}>Bind by UID (e.g. RFID-DFCCIL-008)</Text>
      <TextInput
        style={styles.input}
        value={uid}
        onChangeText={setUid}
        placeholder="RFID-DFCCIL-..."
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />
      <AppButton title="Bind RFID" onPress={bind} loading={loading} style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.sm },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  uid: { fontWeight: "600", color: colors.text },
  label: { fontWeight: "600", color: colors.text, marginVertical: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.card,
    marginBottom: spacing.md,
  },
  smallButton: { marginTop: spacing.xs },
  button: { marginTop: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
