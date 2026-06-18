import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Image, Pressable, Linking } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import StatusBadge from "../components/StatusBadge";
import { translateEnum } from "../utils/translateRecord";
import * as supportService from "../services/supportService";
import type { SupportTicket } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "SupportTicketDetail">;

export default function SupportTicketDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await supportService.getTicketById(route.params.id);
      setTicket(data);
      setError(data ? "" : t("common.noData"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [route.params.id, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openAttachment = async (url: string) => {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={t("support.ticketDetails")} onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {ticket ? (
        <AppCard>
          <Text style={styles.subject}>{ticket.subject}</Text>
          <View style={styles.metaRow}>
            <StatusBadge status={ticket.status} />
            <Text style={styles.meta}>{translateEnum(t, "priority", ticket.priority)}</Text>
          </View>
          <Text style={styles.label}>{t("support.description")}</Text>
          <Text style={styles.body}>{ticket.description}</Text>

          {ticket.attachments.length > 0 ? (
            <>
              <Text style={[styles.label, { marginTop: spacing.md }]}>{t("support.attachments")}</Text>
              {ticket.attachments.map((file) => {
                const isImage = file.mimeType.startsWith("image/");
                return (
                  <Pressable
                    key={file.path || file.url}
                    style={styles.attachmentCard}
                    onPress={() => openAttachment(file.url)}
                  >
                    {isImage ? (
                      <Image source={{ uri: file.url }} style={styles.attachmentImage} />
                    ) : (
                      <View style={styles.fileIcon}>
                        <Text style={styles.fileIconText}>📎</Text>
                      </View>
                    )}
                    <View style={styles.attachmentInfo}>
                      <Text style={styles.attachmentName} numberOfLines={2}>
                        {file.name}
                      </Text>
                      <Text style={styles.openLink}>{t("support.openAttachment")}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          <Text style={styles.date}>
            {t("support.created")}: {new Date(ticket.createdAt).toLocaleString()}
          </Text>
        </AppCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  subject: { fontSize: 18, fontWeight: "700", color: colors.text },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  meta: { color: colors.textMuted, fontSize: 13 },
  label: { fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  body: { color: colors.text, lineHeight: 22 },
  attachmentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  attachmentImage: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.border },
  fileIcon: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.emeraldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  fileIconText: { fontSize: 24 },
  attachmentInfo: { flex: 1 },
  attachmentName: { color: colors.text, fontWeight: "600" },
  openLink: { color: colors.emerald, fontSize: 12, marginTop: 4 },
  date: { color: colors.textMuted, marginTop: spacing.md, fontSize: 12 },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
