import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import AppButton from "../components/AppButton";
import * as authService from "../services/authService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    const result = await authService.login(email, password);
    setLoading(false);
    if (result.success) {
      navigation.replace("Home");
    } else {
      setError(result.error || "Invalid credentials");
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Text style={styles.logoIcon}>⚡</Text>
        </View>
        <Text style={styles.brand}>DFCCIL EV CMS</Text>
        <Text style={styles.tagline}>Charge smarter across DFCCIL sites</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to start or manage charging</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder="name@dfccil.gov.in"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <AppButton title="Sign in" onPress={handleLogin} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  hero: {
    backgroundColor: colors.navy,
    paddingTop: 80,
    paddingBottom: 40,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  logoIcon: { fontSize: 28 },
  brand: { ...typography.h1, color: colors.white },
  tagline: { color: "#9ca3af", marginTop: spacing.sm, fontSize: 15 },
  form: { flex: 1, padding: spacing.lg },
  title: { ...typography.h2, color: colors.text, marginTop: spacing.md },
  subtitle: { color: colors.textMuted, marginBottom: spacing.lg },
  error: { color: colors.danger, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    fontSize: 15,
  },
});
