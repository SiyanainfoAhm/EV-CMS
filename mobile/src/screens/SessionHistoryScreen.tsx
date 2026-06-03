import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import SessionCard from "../components/SessionCard";
import * as sessionService from "../services/sessionService";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "SessionHistory">;

export default function SessionHistoryScreen({ navigation }: Props) {
  const [sessions, setSessions] = useState<ChargingSession[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await sessionService.getSessionHistory();
      setSessions(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Session History" subtitle="Your completed sessions" onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {sessions.length === 0 && !error ? (
        <Text style={styles.empty}>No session history yet</Text>
      ) : null}
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  error: { color: colors.danger, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
});
