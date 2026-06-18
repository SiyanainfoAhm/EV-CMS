import { useState } from "react";
import { Text, TextInput, View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as supportService from "../services/supportService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Support">;

export default function SupportScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const id = await supportService.createSupportTicket({
        subject,
        description: message,
      });
      setSuccess(t("support.ticketCreated", { id: id.slice(0, 8) }));
      setSubject("");
      setMessage("");
      setTimeout(() => navigation.navigate("SupportTickets"), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <Header title={t("support.createTicket")} onBack={() => navigation.goBack()} />
      <AppButton
        title={t("support.viewTickets")}
        variant="outline"
        onPress={() => navigation.navigate("SupportTickets")}
        style={styles.linkBtn}
      />
      <AppCard style={styles.card}>
        <Text style={styles.label}>{t("support.subject")}</Text>
        <TextInput
          style={styles.input}
          placeholder={t("support.subjectPlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={subject}
          onChangeText={setSubject}
        />
        <Text style={[styles.label, { marginTop: spacing.md }]}>{t("support.description")}</Text>
        <TextInput
          style={[styles.input, styles.area]}
          multiline
          placeholder={t("support.messagePlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={message}
          onChangeText={setMessage}
        />
      </AppCard>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <AppButton title={t("support.submit")} onPress={submit} loading={loading} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  card: { marginBottom: spacing.sm },
  linkBtn: { marginBottom: spacing.sm },
  button: { marginTop: spacing.sm },
  label: { fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.card,
  },
  area: { minHeight: 100, textAlignVertical: "top" },
  error: { color: colors.danger, marginVertical: spacing.sm },
  success: { color: colors.emerald, marginVertical: spacing.sm, fontWeight: "600" },
});
