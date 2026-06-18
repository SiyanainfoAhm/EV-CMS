import { useState } from "react";
import {
  Text,
  TextInput,
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as supportService from "../services/supportService";
import type { SupportTicketAttachmentInput } from "../services/supportService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Support">;

const MAX_ATTACHMENTS = 5;

export default function SupportScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<SupportTicketAttachmentInput[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const pickAttachment = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      Alert.alert(t("common.error"), t("support.maxAttachments", { count: MAX_ATTACHMENTS }));
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("common.error"), t("support.attachmentPermission"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS - attachments.length,
    });

    if (result.canceled) return;

    const picked = result.assets.map((asset) => ({
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      name: asset.fileName ?? `attachment-${Date.now()}.jpg`,
    }));

    setAttachments((prev) => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const id = await supportService.createSupportTicketWithAttachments(
        { subject, description: message },
        attachments
      );
      setSuccess(t("support.ticketCreated", { id: id.slice(0, 8) }));
      setSubject("");
      setMessage("");
      setAttachments([]);
      setTimeout(() => navigation.navigate("SupportTickets"), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
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

        <Text style={[styles.label, { marginTop: spacing.md }]}>{t("support.attachments")}</Text>
        <Text style={styles.hint}>{t("support.attachmentsHint")}</Text>
        <AppButton
          title={t("support.addAttachment")}
          onPress={pickAttachment}
          variant="outline"
          style={styles.attachBtn}
        />

        {attachments.map((file, index) => (
          <View key={`${file.uri}-${index}`} style={styles.attachmentRow}>
            <Image source={{ uri: file.uri }} style={styles.thumb} />
            <Text style={styles.attachmentName} numberOfLines={1}>
              {file.name ?? t("support.attachment")}
            </Text>
            <Pressable onPress={() => removeAttachment(index)} style={styles.removeBtn}>
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        ))}
      </AppCard>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <AppButton title={t("support.submit")} onPress={submit} loading={loading} style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  card: { marginBottom: spacing.sm },
  linkBtn: { marginBottom: spacing.sm },
  button: { marginTop: spacing.sm },
  label: { fontWeight: "600", color: colors.text, marginBottom: 6 },
  hint: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.card,
  },
  area: { minHeight: 100, textAlignVertical: "top" },
  attachBtn: { marginBottom: spacing.sm },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.border },
  attachmentName: { flex: 1, color: colors.text },
  removeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  removeText: { fontSize: 22, color: colors.danger, fontWeight: "700" },
  error: { color: colors.danger, marginVertical: spacing.sm },
  success: { color: colors.emerald, marginVertical: spacing.sm, fontWeight: "600" },
});
