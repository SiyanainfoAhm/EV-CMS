import { useCallback, useState } from "react";
import { Text, ScrollView, StyleSheet, TextInput, Alert, View, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as rfidService from "../services/rfidService";
import { maskRfidUid } from "../utils/maskRfid";
import type { RFIDCard } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "RFIDBinding">;

export default function RFIDBindingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<RFIDCard[]>([]);
  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await rfidService.getUserRfidCards();
      setCards(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const bind = async () => {
    setLoading(true);
    try {
      await rfidService.bindRfid(uid);
      setUid("");
      await load();
      Alert.alert(t("common.success"), t("rfid.bindSuccess"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const unbind = (card: RFIDCard) => {
    Alert.alert(t("common.confirm"), t("rfid.unbindConfirm", { uid: maskRfidUid(card.uid) }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("rfid.unbind"),
        style: "destructive",
        onPress: async () => {
          try {
            await rfidService.unbindRfid(card.id);
            await load();
          } catch (e) {
            Alert.alert(t("common.error"), e instanceof Error ? e.message : t("common.error"));
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
    >
      <Header title={t("rfid.title")} onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cards.length === 0 && !error ? <Text style={styles.empty}>{t("rfid.noCards")}</Text> : null}
      {cards.map((c) => (
        <AppCard key={c.id} style={styles.card}>
          <View style={styles.cardRow}>
            <View>
              <Text style={styles.uidLabel}>{t("rfid.cardNumber")}</Text>
              <Text style={styles.uid}>{maskRfidUid(c.uid)}</Text>
            </View>
            <StatusBadge status={c.status} />
          </View>
          <AppButton title={t("rfid.unbind")} onPress={() => unbind(c)} variant="outline" style={styles.smallButton} />
        </AppCard>
      ))}
      <Text style={styles.label}>{t("rfid.bindLabel")}</Text>
      <TextInput
        style={styles.input}
        value={uid}
        onChangeText={setUid}
        placeholder={t("rfid.bindPlaceholder")}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />
      <AppButton title={t("rfid.bind")} onPress={bind} loading={loading} style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.sm },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  uidLabel: { fontSize: 12, color: colors.textMuted },
  uid: { fontWeight: "600", color: colors.text, marginTop: 2 },
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
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
});
