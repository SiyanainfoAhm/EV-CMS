import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useTranslation } from "react-i18next";
import AppButton from "./AppButton";
import * as tariffService from "../services/tariffService";
import type { ActiveTariff, ChargeInputMode } from "../services/tariffService";
import { formatCurrency } from "../utils/format";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

export type ChargePriceResult = {
  inputMode: ChargeInputMode;
  prepaidAmount: number;
  targetKwh: number;
  tariff: ActiveTariff;
};

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (result: ChargePriceResult) => void;
};

const QUICK_AMOUNTS = [100, 200, 500, 1000];
const QUICK_KWH = [5, 10, 20, 30];

function parseDecimal(text: string): number {
  return Number(text.replace(/[^0-9.]/g, ""));
}

export default function ChargePricePrompt({ visible, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [tariff, setTariff] = useState<ActiveTariff | null>(null);
  const [loading, setLoading] = useState(false);
  const [inputMode, setInputMode] = useState<ChargeInputMode>("amount");
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setInputMode("amount");
    setInputText("");
    setError("");
    setLoading(true);
    tariffService
      .getActiveChargingTariff()
      .then((row) => setTariff(row))
      .catch(() => setTariff(null))
      .finally(() => setLoading(false));
  }, [visible]);

  const inputValue = parseDecimal(inputText);

  const resolved = useMemo(() => {
    if (!tariff || !Number.isFinite(inputValue) || inputValue <= 0) {
      return { prepaidAmount: 0, targetKwh: 0 };
    }
    return tariffService.resolveChargeFromInput(inputMode, inputValue, tariff.ratePerKwh);
  }, [inputMode, inputValue, tariff]);

  const switchMode = (mode: ChargeInputMode) => {
    if (mode === inputMode) return;
    if (tariff && Number.isFinite(inputValue) && inputValue > 0) {
      const converted = tariffService.resolveChargeFromInput(inputMode, inputValue, tariff.ratePerKwh);
      setInputText(
        mode === "amount" ? String(converted.prepaidAmount) : String(converted.targetKwh)
      );
    } else {
      setInputText("");
    }
    setInputMode(mode);
    setError("");
  };

  const confirm = () => {
    if (!tariff) {
      setError(t("chargePrice.tariffMissing"));
      return;
    }
    if (!Number.isFinite(inputValue) || inputValue <= 0) {
      setError(inputMode === "amount" ? t("chargePrice.amountRequired") : t("chargePrice.kwhRequired"));
      return;
    }
    if (resolved.prepaidAmount < 1) {
      setError(t("chargePrice.amountRequired"));
      return;
    }
    onConfirm({
      inputMode,
      prepaidAmount: resolved.prepaidAmount,
      targetKwh: resolved.targetKwh,
      tariff,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{t("chargePrice.title")}</Text>
          <Text style={styles.subtitle}>{t("chargePrice.subtitle")}</Text>

          {loading ? (
            <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} />
          ) : tariff ? (
            <View style={styles.rateBox}>
              <Text style={styles.rateLabel}>{t("chargePrice.todaysRate")}</Text>
              <Text style={styles.rateValue}>
                {formatCurrency(tariff.ratePerKwh)}
                <Text style={styles.rateUnit}> / kWh</Text>
              </Text>
              {tariff.region ? <Text style={styles.region}>{tariff.region}</Text> : null}
              {tariff.gstPercent > 0 ? (
                <Text style={styles.gstNote}>
                  {t("chargePrice.gstNote", { percent: tariff.gstPercent })}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.error}>{t("chargePrice.tariffMissing")}</Text>
          )}

          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeChip, inputMode === "amount" && styles.modeChipActive]}
              onPress={() => switchMode("amount")}
            >
              <Text style={[styles.modeText, inputMode === "amount" && styles.modeTextActive]}>
                {t("chargePrice.modeAmount")}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeChip, inputMode === "kwh" && styles.modeChipActive]}
              onPress={() => switchMode("kwh")}
            >
              <Text style={[styles.modeText, inputMode === "kwh" && styles.modeTextActive]}>
                {t("chargePrice.modeKwh")}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.inputLabel}>
            {inputMode === "amount" ? t("chargePrice.enterAmount") : t("chargePrice.enterKwh")}
          </Text>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={(v) => {
              setInputText(v);
              setError("");
            }}
            keyboardType="decimal-pad"
            placeholder={
              inputMode === "amount"
                ? t("chargePrice.amountPlaceholder")
                : t("chargePrice.kwhPlaceholder")
            }
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.quickRow}>
            {inputMode === "amount"
              ? QUICK_AMOUNTS.map((q) => (
                  <Pressable
                    key={q}
                    style={[styles.quickChip, inputValue === q && styles.quickChipActive]}
                    onPress={() => {
                      setInputText(String(q));
                      setError("");
                    }}
                  >
                    <Text style={[styles.quickText, inputValue === q && styles.quickTextActive]}>
                      ₹{q}
                    </Text>
                  </Pressable>
                ))
              : QUICK_KWH.map((q) => (
                  <Pressable
                    key={q}
                    style={[styles.quickChip, inputValue === q && styles.quickChipActive]}
                    onPress={() => {
                      setInputText(String(q));
                      setError("");
                    }}
                  >
                    <Text style={[styles.quickText, inputValue === q && styles.quickTextActive]}>
                      {q} kWh
                    </Text>
                  </Pressable>
                ))}
          </View>

          {resolved.prepaidAmount > 0 && resolved.targetKwh > 0 ? (
            <Text style={styles.estimate}>
              {inputMode === "amount"
                ? t("chargePrice.estimatedEnergy", { kwh: resolved.targetKwh.toFixed(2) })
                : t("chargePrice.estimatedAmount", { amount: formatCurrency(resolved.prepaidAmount) })}
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AppButton title={t("chargePrice.confirmStart")} onPress={confirm} style={styles.btn} />
          <AppButton title={t("common.cancel")} onPress={onCancel} variant="outline" style={styles.btn} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  card: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  subtitle: { marginTop: 6, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  rateBox: {
    marginTop: spacing.md,
    backgroundColor: colors.emeraldMuted,
    borderRadius: 12,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.emerald,
  },
  rateLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  rateValue: { marginTop: 4, fontSize: 28, fontWeight: "800", color: colors.emerald },
  rateUnit: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  region: { marginTop: 4, fontSize: 12, color: colors.textMuted },
  gstNote: { marginTop: 6, fontSize: 12, color: colors.textMuted },
  modeRow: { flexDirection: "row", gap: 8, marginTop: spacing.md },
  modeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: colors.background,
  },
  modeChipActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldMuted },
  modeText: { fontWeight: "600", color: colors.textMuted, fontSize: 14 },
  modeTextActive: { color: colors.emerald },
  inputLabel: { marginTop: spacing.md, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    backgroundColor: colors.background,
  },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.sm },
  quickChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  quickChipActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldMuted },
  quickText: { color: colors.text, fontWeight: "600" },
  quickTextActive: { color: colors.emerald },
  estimate: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13 },
  error: { marginTop: spacing.sm, color: colors.danger, fontSize: 13 },
  btn: { marginTop: spacing.sm },
});
