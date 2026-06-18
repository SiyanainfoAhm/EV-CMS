import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import AppButton from "../components/AppButton";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useAuth } from "../context/AuthContext";
import type { AppLanguage } from "../i18n";
import i18n from "../i18n";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, ready } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>((i18n.language as AppLanguage) || "en");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    const result = await signIn(email, password);
    setLoading(false);
    if (!result.success) {
      setError(result.error || t("auth.invalidUser"));
    }
  };

  if (!ready) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={colors.emerald} />
        <Text style={styles.restoring}>{t("auth.restoring")}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Text style={styles.logoIcon}>⚡</Text>
        </View>
        <Text style={styles.brand}>{t("auth.loginTitle")}</Text>
        <Text style={styles.tagline}>{t("dashboard.subtitle")}</Text>
      </View>
      <View style={styles.form}>
        <LanguageSwitcher value={language} onChange={setLanguage} />
        <Text style={styles.title}>{t("common.login")}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder={t("common.email")}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder={t("common.password")}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <AppButton title={loading ? t("common.loading") : t("common.submit")} onPress={handleLogin} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: "center", justifyContent: "center" },
  restoring: { marginTop: spacing.md, color: colors.textMuted, fontSize: 14 },
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
