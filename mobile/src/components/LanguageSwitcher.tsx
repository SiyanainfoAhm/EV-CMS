import { Pressable, Text, View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "../i18n";
import { setAppLanguage } from "../i18n";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  value: AppLanguage;
  onChange: (lang: AppLanguage) => void;
}

export default function LanguageSwitcher({ value, onChange }: Props) {
  const { t } = useTranslation();

  const select = async (lang: AppLanguage) => {
    await setAppLanguage(lang);
    onChange(lang);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t("profile.language")}</Text>
      <View style={styles.row}>
        {(["en", "hi"] as AppLanguage[]).map((lang) => (
          <Pressable
            key={lang}
            style={[styles.chip, value === lang && styles.chipActive]}
            onPress={() => select(lang)}
          >
            <Text style={[styles.chipText, value === lang && styles.chipTextActive]}>
              {lang === "en" ? t("profile.english") : t("profile.hindi")}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  label: { fontWeight: "600", color: colors.text, marginBottom: 6 },
  row: { flexDirection: "row", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.emeraldMuted, borderColor: colors.emerald },
  chipText: { color: colors.textMuted, fontWeight: "500" },
  chipTextActive: { color: colors.emerald, fontWeight: "700" },
});
