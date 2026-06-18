import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, Pressable, RefreshControl, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as supportService from "../services/supportService";
import type { SupportTicket } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "SupportTickets">;

export default function SupportTicketListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setTickets(await supportService.getTickets());
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

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
    >
      <Header title={t("support.myTickets")} onBack={() => navigation.goBack()} />
      <AppButton title={t("support.createTicket")} onPress={() => navigation.navigate("Support")} style={styles.newBtn} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {tickets.length === 0 && !error ? <Text style={styles.empty}>{t("support.noTickets")}</Text> : null}
      {tickets.map((ticket) => (
        <Pressable key={ticket.id} onPress={() => navigation.navigate("SupportTicketDetail", { id: ticket.id })}>
          <AppCard style={styles.card}>
            <Text style={styles.subject}>{ticket.subject}</Text>
            <Text style={styles.desc} numberOfLines={2}>
              {ticket.description}
            </Text>
            {ticket.attachments.length > 0 ? (
              <Text style={styles.attachMeta}>
                {t("support.attachments")}: {ticket.attachments.length}
              </Text>
            ) : null}
            <View style={styles.meta}>
              <StatusBadge status={ticket.status} />
              <Text style={styles.date}>
                {t("support.created")}: {new Date(ticket.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </AppCard>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  newBtn: { marginBottom: spacing.md },
  card: { marginBottom: spacing.sm },
  subject: { fontSize: 16, fontWeight: "700", color: colors.text },
  desc: { color: colors.textMuted, marginTop: 6, fontSize: 14 },
  attachMeta: { color: colors.emerald, fontSize: 12, marginTop: 6, fontWeight: "600" },
  meta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  date: { fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
});
