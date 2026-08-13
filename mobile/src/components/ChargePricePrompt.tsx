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
  ScrollView,
} from "react-native";
import { useTranslation } from "react-i18next";
import AppButton from "./AppButton";
import * as prepaidPlanService from "../services/prepaidPlanService";
import * as tariffService from "../services/tariffService";
import type { ChargerTariff } from "../services/tariffService";
import {
  DEFAULT_AMOUNT_CHIPS,
  DEFAULT_TIME_CHIPS_MINUTES,
  buildAmountOrderPayload,
  buildTimeOrderPayload,
  calculateAmountPayment,
  calculateTimePayment,
  formatTimeChipLabel,
  logPrepaidCalculation,
  matchPlanIdByValue,
  sanitizeAmountInput,
  sanitizeMinutesInput,
  validatePrepaidAmount,
  validatePrepaidMinutes,
  type PrepaidPaymentOrderPayload,
} from "../utils/prepaidPayment";
import type {
  Charger,
  EVPrepaidPlan,
  PrepaidMode,
  PrepaidPaymentCalculation,
} from "../types";
import { formatCurrency } from "../utils/format";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

export type PrepaidPlanResult = {
  mode: PrepaidMode;
  plan: EVPrepaidPlan | null;
  isCustom: boolean;
  /** Selected amount (₹) or duration (minutes). */
  selectedValue: number;
  calculation: PrepaidPaymentCalculation;
  paymentPayload: PrepaidPaymentOrderPayload;
  tariff: ChargerTariff;
};

/** @deprecated Use PrepaidPlanResult */
export type ChargePriceResult = PrepaidPlanResult;

type Props = {
  visible: boolean;
  charger: Pick<
    Charger,
    "id" | "maxPowerKw" | "type" | "name" | "model" | "chargePointId" | "tariffId"
  > | null;
  onCancel: () => void;
  onConfirm: (result: PrepaidPlanResult) => void;
};

type Selection =
  | { kind: "preset"; value: number }
  | { kind: "custom" }
  | null;

export default function ChargePricePrompt({ visible, charger, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<PrepaidMode>("amount");
  const [plans, setPlans] = useState<EVPrepaidPlan[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [customAmountText, setCustomAmountText] = useState("");
  const [customMinutesText, setCustomMinutesText] = useState("");
  const [tariff, setTariff] = useState<ChargerTariff | null>(null);
  const [inlineError, setInlineError] = useState("");

  useEffect(() => {
    if (!visible || !charger) return;
    setMode("amount");
    setSelection(null);
    setCustomAmountText("");
    setCustomMinutesText("");
    setInlineError("");
    setLoading(true);
    prepaidPlanService
      .fetchPrepaidPlans(true)
      .then(setPlans)
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));

    tariffService
      .getTariffForCharger(charger)
      .then((t) => {
        setTariff(t);
        logPrepaidCalculation("modal tariff loaded", {
          charger_type: charger.type,
          tariff_id: t.id,
          tariff_name: t.name,
          rate_per_kwh: t.ratePerKwh,
          session_fee: t.sessionFee,
          gst_percent: t.gstPercent,
        });
      })
      .catch(() => setTariff(null));
  }, [visible, charger?.id, charger?.tariffId, charger?.type, charger?.maxPowerKw]);

  const { amountPlans, timePlans } = useMemo(
    () => prepaidPlanService.splitPrepaidPlans(plans),
    [plans]
  );

  const amountChips = useMemo(() => {
    const fromAdmin = amountPlans
      .map((p) => Number(p.amount ?? p.value))
      .filter((v) => Number.isFinite(v) && v > 0);
    const merged = [...new Set([...DEFAULT_AMOUNT_CHIPS, ...fromAdmin])].sort((a, b) => a - b);
    return merged;
  }, [amountPlans]);

  const timeChips = useMemo(() => {
    const fromAdmin = timePlans
      .map((p) => Number(p.durationMinutes ?? p.value))
      .filter((v) => Number.isFinite(v) && v > 0);
    const merged = [...new Set([...DEFAULT_TIME_CHIPS_MINUTES, ...fromAdmin])].sort(
      (a, b) => a - b
    );
    return merged;
  }, [timePlans]);

  const resolved = useMemo(() => {
    if (!selection || !tariff) {
      return { calculation: null as PrepaidPaymentCalculation | null, error: "", planId: null as string | null, value: null as number | null };
    }

    if (mode === "amount") {
      if (selection.kind === "preset") {
        const validation = validatePrepaidAmount(selection.value);
        if (!validation.valid || validation.value == null) {
          return { calculation: null, error: validation.error ?? "", planId: null, value: null };
        }
        return {
          calculation: calculateAmountPayment(validation.value, tariff),
          error: "",
          planId: matchPlanIdByValue(amountPlans, "amount", validation.value),
          value: validation.value,
        };
      }
      const validation = validatePrepaidAmount(customAmountText);
      if (!validation.valid || validation.value == null) {
        return {
          calculation: null,
          error: customAmountText.trim() ? validation.error ?? "" : "",
          planId: null,
          value: null,
        };
      }
      return {
        calculation: calculateAmountPayment(validation.value, tariff),
        error: "",
        planId: null,
        value: validation.value,
      };
    }

    // time mode
    if (selection.kind === "preset") {
      const validation = validatePrepaidMinutes(selection.value);
      if (!validation.valid || validation.value == null || !charger) {
        return {
          calculation: null,
          error: !charger ? t("prepaid.unableToCalculate") : validation.error ?? "",
          planId: null,
          value: null,
        };
      }
      return {
        calculation: calculateTimePayment(charger, validation.value, tariff),
        error: "",
        planId: matchPlanIdByValue(timePlans, "time", validation.value),
        value: validation.value,
      };
    }

    const validation = validatePrepaidMinutes(customMinutesText);
    if (!validation.valid || validation.value == null) {
      return {
        calculation: null,
        error: customMinutesText.trim() ? validation.error ?? "" : "",
        planId: null,
        value: null,
      };
    }
    if (!charger) {
      return { calculation: null, error: t("prepaid.unableToCalculate"), planId: null, value: null };
    }
    return {
      calculation: calculateTimePayment(charger, validation.value, tariff),
      error: "",
      planId: null,
      value: validation.value,
    };
  }, [
    selection,
    mode,
    customAmountText,
    customMinutesText,
    charger,
    amountPlans,
    timePlans,
    tariff,
    t,
  ]);

  useEffect(() => {
    setInlineError(resolved.error);
  }, [resolved.error]);

  const canPay =
    Boolean(charger) &&
    Boolean(tariff) &&
    selection != null &&
    resolved.calculation != null &&
    resolved.calculation.totalAmount > 0 &&
    !resolved.error &&
    (selection.kind === "preset" ||
      (mode === "amount" ? customAmountText.trim().length > 0 : customMinutesText.trim().length > 0));

  const switchMode = (next: PrepaidMode) => {
    setMode(next);
    setSelection(null);
    setCustomAmountText("");
    setCustomMinutesText("");
    setInlineError("");
  };

  const selectPreset = (value: number) => {
    setSelection({ kind: "preset", value });
    setCustomAmountText("");
    setCustomMinutesText("");
    setInlineError("");
  };

  const selectCustom = () => {
    setSelection({ kind: "custom" });
    setInlineError("");
  };

  const confirm = () => {
    if (!canPay || !resolved.calculation || resolved.value == null || !selection || !charger || !tariff) return;

    const isCustom = selection.kind === "custom";
    const plan =
      !isCustom && resolved.planId
        ? (mode === "amount" ? amountPlans : timePlans).find((p) => p.id === resolved.planId) ?? null
        : null;

    const paymentPayload =
      mode === "amount"
        ? buildAmountOrderPayload({
            charger,
            tariff,
            planId: resolved.planId,
            isCustom,
            amount: resolved.value,
            calculation: resolved.calculation,
          })
        : buildTimeOrderPayload({
            charger,
            tariff,
            planId: resolved.planId,
            isCustom,
            durationMinutes: resolved.value,
            calculation: resolved.calculation,
          });

    logPrepaidCalculation("confirm", {
      plan_mode: mode,
      selected_value: resolved.value,
      estimated_kwh: resolved.calculation.estimatedKwh,
      subtotal: resolved.calculation.subtotal ?? resolved.calculation.baseAmount,
      gst_amount: resolved.calculation.gstAmount,
      total_amount: resolved.calculation.totalAmount,
      tariff_id: tariff.id,
      rate_per_kwh: tariff.ratePerKwh,
      session_fee: tariff.sessionFee,
    });

    onConfirm({
      mode,
      plan,
      isCustom,
      selectedValue: resolved.value,
      calculation: resolved.calculation,
      paymentPayload,
      tariff,
    });
  };

  const showCustomAmount = mode === "amount" && selection?.kind === "custom";
  const showCustomMinutes = mode === "time" && selection?.kind === "custom";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{t("prepaid.title")}</Text>
            <Text style={styles.subtitle}>{t("prepaid.subtitle")}</Text>

            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeChip, mode === "amount" && styles.modeChipActive]}
                onPress={() => switchMode("amount")}
              >
                <Text style={[styles.modeText, mode === "amount" && styles.modeTextActive]}>
                  {t("prepaid.modeAmount")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeChip, mode === "time" && styles.modeChipActive]}
                onPress={() => switchMode("time")}
              >
                <Text style={[styles.modeText, mode === "time" && styles.modeTextActive]}>
                  {t("prepaid.modeTime")}
                </Text>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} />
            ) : (
              <View style={styles.planGrid}>
                {mode === "amount"
                  ? amountChips.map((amount) => {
                      const active =
                        selection?.kind === "preset" && selection.value === amount;
                      return (
                        <Pressable
                          key={`amt-${amount}`}
                          style={[styles.planChip, active && styles.planChipActive]}
                          onPress={() => selectPreset(amount)}
                        >
                          <Text style={[styles.planText, active && styles.planTextActive]}>
                            ₹{amount}
                          </Text>
                        </Pressable>
                      );
                    })
                  : timeChips.map((mins) => {
                      const active = selection?.kind === "preset" && selection.value === mins;
                      return (
                        <Pressable
                          key={`time-${mins}`}
                          style={[styles.planChip, active && styles.planChipActive]}
                          onPress={() => selectPreset(mins)}
                        >
                          <Text style={[styles.planText, active && styles.planTextActive]}>
                            {formatTimeChipLabel(mins)}
                          </Text>
                        </Pressable>
                      );
                    })}

                <Pressable
                  style={[
                    styles.planChip,
                    selection?.kind === "custom" && styles.planChipActive,
                  ]}
                  onPress={selectCustom}
                >
                  <Text
                    style={[
                      styles.planText,
                      selection?.kind === "custom" && styles.planTextActive,
                    ]}
                  >
                    {t("prepaid.custom")}
                  </Text>
                </Pressable>
              </View>
            )}

            {showCustomAmount ? (
              <View style={styles.customBox}>
                <Text style={styles.inputLabel}>{t("prepaid.customAmount")}</Text>
                <View style={styles.inputRow}>
                  <Text style={styles.prefix}>₹</Text>
                  <TextInput
                    style={styles.input}
                    value={customAmountText}
                    onChangeText={(v) => {
                      setCustomAmountText(sanitizeAmountInput(v));
                      setInlineError("");
                    }}
                    keyboardType="decimal-pad"
                    placeholder={t("prepaid.customAmountPlaceholder")}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                {inlineError ? <Text style={styles.error}>{inlineError}</Text> : null}
              </View>
            ) : null}

            {showCustomMinutes ? (
              <View style={styles.customBox}>
                <Text style={styles.inputLabel}>{t("prepaid.customDuration")}</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    value={customMinutesText}
                    onChangeText={(v) => {
                      setCustomMinutesText(sanitizeMinutesInput(v));
                      setInlineError("");
                    }}
                    keyboardType="number-pad"
                    placeholder={t("prepaid.customDurationPlaceholder")}
                    placeholderTextColor={colors.textMuted}
                  />
                  <Text style={styles.suffix}>{t("prepaid.minutesSuffix")}</Text>
                </View>
                {inlineError ? <Text style={styles.error}>{inlineError}</Text> : null}
              </View>
            ) : null}

            {!showCustomAmount && !showCustomMinutes && inlineError ? (
              <Text style={styles.error}>{inlineError}</Text>
            ) : null}

            {resolved.calculation && tariff ? (
              <View style={styles.summary}>
                <Text style={styles.metaLine}>
                  {t("prepaid.tariffName", {
                    defaultValue: "Tariff: {{name}}",
                    name: tariff.name,
                  })}
                </Text>
                <Text style={styles.metaLine}>
                  {t("prepaid.ratePerKwh", {
                    defaultValue: "Rate: {{rate}}/kWh",
                    rate: formatCurrency(tariff.ratePerKwh),
                  })}
                </Text>
                <Text style={styles.metaLine}>
                  {t("prepaid.sessionFee", {
                    defaultValue: "Session fee: {{fee}}",
                    fee:
                      tariff.sessionFee > 0
                        ? formatCurrency(tariff.sessionFee)
                        : t("prepaid.sessionFeeFree", { defaultValue: "Free" }),
                  })}
                </Text>
                <Text style={styles.metaLine}>
                  {t("prepaid.gstLabel", {
                    defaultValue: "GST: {{percent}}%",
                    percent: tariff.gstPercent,
                  })}
                </Text>
                {mode === "time" && resolved.calculation.energyAmount != null ? (
                  <Text style={styles.summaryLine}>
                    {t("prepaid.energyAmount", { defaultValue: "Energy" })}:{" "}
                    {formatCurrency(resolved.calculation.energyAmount)}
                  </Text>
                ) : null}
                {mode === "time" && tariff.sessionFee > 0 ? (
                  <Text style={styles.summaryLine}>
                    {t("prepaid.sessionFee", { defaultValue: "Session fee" })}:{" "}
                    {formatCurrency(tariff.sessionFee)}
                  </Text>
                ) : null}
                <Text style={styles.summaryLine}>
                  {t("prepaid.baseAmount")}:{" "}
                  {formatCurrency(resolved.calculation.subtotal ?? resolved.calculation.baseAmount)}
                </Text>
                <Text style={styles.summaryLine}>
                  {t("prepaid.gstAmount", { percent: resolved.calculation.gstPercent })}:{" "}
                  {formatCurrency(resolved.calculation.gstAmount)}
                </Text>
                <Text style={styles.totalLine}>
                  {t("prepaid.totalAmount")}: {formatCurrency(resolved.calculation.totalAmount)}
                </Text>
                {resolved.calculation.estimatedKwh != null ? (
                  <Text style={styles.metaLine}>
                    {t("prepaid.estimatedEnergy", {
                      kwh: resolved.calculation.estimatedKwh.toFixed(3),
                      kw: resolved.calculation.powerKw ?? "—",
                    })}
                  </Text>
                ) : null}
                {resolved.calculation.powerEstimated ? (
                  <Text style={styles.note}>{t("prepaid.estimateNoteShort")}</Text>
                ) : null}
              </View>
            ) : null}

            <AppButton
              title={t("prepaid.payAndStart")}
              onPress={confirm}
              style={styles.btn}
              disabled={!canPay}
            />
            <AppButton title={t("common.cancel")} onPress={onCancel} variant="outline" style={styles.btn} />
          </ScrollView>
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
    maxHeight: "88%",
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  subtitle: { marginTop: 6, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
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
  planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.md },
  planChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.background,
  },
  planChipActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldMuted },
  planText: { color: colors.text, fontWeight: "600" },
  planTextActive: { color: colors.emerald },
  customBox: { marginTop: spacing.md },
  inputLabel: { fontWeight: "600", color: colors.text, marginBottom: 6 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  prefix: { fontSize: 18, fontWeight: "700", color: colors.text, marginRight: 6 },
  suffix: { fontSize: 13, color: colors.textMuted, marginLeft: 8 },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  inputFlex: { flex: 1 },
  summary: {
    marginTop: spacing.md,
    backgroundColor: colors.emeraldMuted,
    borderRadius: 12,
    padding: spacing.md,
  },
  summaryLine: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  totalLine: { marginTop: 6, fontSize: 18, fontWeight: "800", color: colors.emerald },
  metaLine: { marginTop: 6, fontSize: 12, color: colors.textMuted },
  note: { marginTop: 6, fontSize: 12, color: colors.textMuted, fontStyle: "italic" },
  error: { marginTop: spacing.sm, color: colors.danger, fontSize: 13 },
  btn: { marginTop: spacing.sm },
});
