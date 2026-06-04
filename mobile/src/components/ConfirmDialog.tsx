import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  subtitle?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button (sign out, delete, etc.) */
  destructive?: boolean;
  loading?: boolean;
  icon?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  subtitle,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  icon = "⚠️",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={[styles.iconWrap, destructive && styles.iconWrapDanger]}>
              <Text style={styles.icon}>{icon}</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          </View>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, styles.btnCancel]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.btnCancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, destructive ? styles.btnDanger : styles.btnConfirm]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.btnConfirmText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    zIndex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emeraldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapDanger: { backgroundColor: "#fee2e2" },
  icon: { fontSize: 18 },
  headerText: { flex: 1 },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  message: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  actions: { flexDirection: "row", gap: spacing.sm },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  btnCancel: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  btnCancelText: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  btnConfirm: { backgroundColor: colors.emerald },
  btnDanger: { backgroundColor: colors.danger },
  btnConfirmText: { fontSize: 14, fontWeight: "600", color: colors.white },
});
