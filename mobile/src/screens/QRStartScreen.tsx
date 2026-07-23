import { useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, TextInput, Alert, Platform, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import QrCameraScanner from "../components/QrCameraScanner";
import ChargePricePrompt, { type PrepaidPlanResult } from "../components/ChargePricePrompt";
import * as paymentService from "../services/paymentService";
import * as chargerService from "../services/chargerService";
import { useAuth } from "../context/AuthContext";
import { isMobileEndUser } from "../utils/rfpRoles";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import { showChargingErrorAlert } from "../utils/chargingErrors";
import type { Charger } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "QRStart">;

const SCAN_DEBOUNCE_MS = 2500;
const isWeb = Platform.OS === "web";

type PendingStart = {
  charger: Charger;
  connectorId: number;
};

export default function QRStartScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCharge = user ? isMobileEndUser(user.role) : false;
  const defaultConnector = route.params.connectorId ?? 1;
  const fromChargerDetail = Boolean(route.params.chargerId);
  const [qrInput, setQrInput] = useState("");
  const [showManual, setShowManual] = useState(isWeb);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pricePromptVisible, setPricePromptVisible] = useState(false);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const scanLock = useRef(false);
  const lastScanAt = useRef(0);

  const requestPriceThenStart = useCallback(
    async (chargerId: string, connectorId: number) => {
      setLoading(true);
      try {
        const charger = await chargerService.getChargerById(chargerId);
        if (!charger) {
          setError(t("charger.noneAvailable"));
          return;
        }
        if (!chargerService.canStartCharging(charger)) {
          Alert.alert(t("common.error"), t(chargerService.getChargerUnavailableMessageKey(charger)));
          return;
        }
        setPendingStart({ charger, connectorId });
        setPricePromptVisible(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("charger.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  const startWithPayload = useCallback(
    async (raw: string) => {
      setError("");
      setLoading(true);
      try {
        const { charger, connectorId } = await chargerService.validateQr(raw);
        if (!chargerService.canStartCharging(charger)) {
          Alert.alert(t("common.error"), t(chargerService.getChargerUnavailableMessageKey(charger)));
          return;
        }
        const gun = charger.connectors.find((c) => c.connectorId === connectorId);
        const gunStatus = String(gun?.status || "")
          .toLowerCase()
          .trim();
        if (gunStatus === "available") {
          Alert.alert(
            t("charger.plugCableTitle", { defaultValue: "Plug in the cable" }),
            t("charger.plugCableBody", {
              defaultValue:
                "Connect the cable to your vehicle and wait until this gun shows Preparing, then scan again.",
            })
          );
          return;
        }
        setPendingStart({ charger, connectorId });
        setPricePromptVisible(true);
      } catch (e) {
        if (e instanceof Error && e.message === "INVALID_QR") {
          setError(t("qr.invalidQr"));
          Alert.alert(t("common.error"), t("qr.invalidQr"));
        } else if (e instanceof Error && /not online/i.test(e.message)) {
          Alert.alert(t("common.error"), t("charger.cannotStartNotOnline"));
        } else {
          showChargingErrorAlert(e, t, navigation);
        }
      } finally {
        setLoading(false);
        scanLock.current = false;
      }
    },
    [navigation, t]
  );

  const onScan = (data: string) => {
    const now = Date.now();
    if (scanLock.current || now - lastScanAt.current < SCAN_DEBOUNCE_MS) return;
    scanLock.current = true;
    lastScanAt.current = now;
    if (canCharge) startWithPayload(data);
  };

  const manualStart = async () => {
    if (!fromChargerDetail) {
      if (qrInput.trim()) {
        await startWithPayload(qrInput.trim());
        return;
      }
      setError(t("qr.invalidQr"));
      return;
    }
    await requestPriceThenStart(route.params.chargerId!, defaultConnector);
  };

  const confirmPriceAndStart = async (result: PrepaidPlanResult) => {
    if (!pendingStart || !user) return;
    if (!chargerService.canStartCharging(pendingStart.charger)) {
      setPricePromptVisible(false);
      Alert.alert(t("common.error"), t("charger.cannotStartNotOnline"));
      return;
    }
    setPricePromptVisible(false);
    setLoading(true);
    setError("");
    try {
      await paymentService.createRazorpaySessionPayment({
        chargerId: pendingStart.charger.id,
        connectorId: pendingStart.connectorId,
        userId: user.id,
        calculation: result.calculation,
        paymentPayload: result.paymentPayload,
        tariffId: pendingStart.charger.tariffId ?? undefined,
      });
      setPendingStart(null);
      navigation.replace("LiveSession");
    } catch (e) {
      const message = e instanceof Error ? e.message : t("charger.startFailed");
      if (/Payment cancelled/i.test(message)) {
        Alert.alert(t("common.error"), t("prepaid.paymentCancelled"));
      } else if (/not online/i.test(message)) {
        Alert.alert(t("common.error"), t("charger.cannotStartNotOnline"));
      } else if (/Payment failed|Unable to create payment order/i.test(message)) {
        Alert.alert(t("common.error"), t("prepaid.paymentFailed"));
      } else if (/Session could not be started/i.test(message)) {
        Alert.alert(t("common.error"), t("prepaid.sessionStartFailed"));
      } else {
        showChargingErrorAlert(e, t, navigation);
      }
    } finally {
      setLoading(false);
      scanLock.current = false;
    }
  };

  return (
    <View style={styles.root}>
      <Header title={t("qr.title")} onBack={() => navigation.goBack()} />
      {isWeb ? <Text style={styles.webNote}>{t("qr.webOnlyHint")}</Text> : null}
      <AppCard style={styles.scanBox}>
        <QrCameraScanner onScan={onScan} active={canCharge && !loading} />
      </AppCard>

      {isWeb && !fromChargerDetail ? (
        <>
          <Text style={styles.label}>{t("qr.enterCode")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("qr.payloadPlaceholder")}
            placeholderTextColor={colors.textMuted}
            value={qrInput}
            onChangeText={setQrInput}
            autoCapitalize="characters"
          />
        </>
      ) : null}

      {!isWeb && !fromChargerDetail ? (
        <Pressable onPress={() => setShowManual((v) => !v)}>
          <Text style={styles.advancedToggle}>
            {showManual ? "−" : "+"} {t("qr.enterCode")}
          </Text>
        </Pressable>
      ) : null}

      {showManual && !isWeb && !fromChargerDetail ? (
        <TextInput
          style={styles.input}
          placeholder={t("qr.payloadPlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={qrInput}
          onChangeText={setQrInput}
          autoCapitalize="characters"
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!canCharge ? (
        <AdminNoticeBanner />
      ) : (
        <>
          <Text style={styles.or}>{t("qr.manualStart", { connector: defaultConnector })}</Text>
          <AppButton
            title={t("charger.startCharging")}
            onPress={manualStart}
            loading={loading}
            style={styles.button}
          />
        </>
      )}

      <ChargePricePrompt
        visible={pricePromptVisible}
        charger={pendingStart?.charger ?? null}
        onCancel={() => {
          setPricePromptVisible(false);
          setPendingStart(null);
          scanLock.current = false;
        }}
        onConfirm={confirmPriceAndStart}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  scanBox: { padding: spacing.sm, marginBottom: spacing.sm },
  webNote: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
  label: { fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.card,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  advancedToggle: { color: colors.emerald, fontSize: 13, marginVertical: spacing.sm },
  error: { color: colors.danger, marginTop: spacing.sm },
  or: { textAlign: "center", color: colors.textMuted, marginVertical: spacing.md, fontSize: 13 },
  button: { marginTop: spacing.sm },
});
