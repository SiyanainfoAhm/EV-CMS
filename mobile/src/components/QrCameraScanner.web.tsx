import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  onScan: (data: string) => void;
  active?: boolean;
}

/** Web: camera is native-only; manual QR paste is used on QRStartScreen. */
export default function QrCameraScanner({ onScan: _onScan, active: _active = true }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.placeholder}>
      <Text style={styles.hint}>{t("qr.scanHint")}</Text>
      <Text style={styles.sub}>{t("qr.manualHint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: 220,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.emerald,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  hint: { color: colors.text, fontWeight: "600", textAlign: "center" },
  sub: { color: colors.textMuted, marginTop: 8, textAlign: "center", fontSize: 13 },
});
