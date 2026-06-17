import { useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, TextInput, Alert, Platform, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import QrCameraScanner from "../components/QrCameraScanner";
import * as chargingService from "../services/chargingService";
import * as chargerService from "../services/chargerService";
import { useAuth } from "../context/AuthContext";
import { isMobileEndUser } from "../utils/rfpRoles";
import AdminNoticeBanner from "../components/AdminNoticeBanner";
import { showChargingErrorAlert } from "../utils/chargingErrors";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "QRStart">;

const SCAN_DEBOUNCE_MS = 2500;
const isWeb = Platform.OS === "web";

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
  const scanLock = useRef(false);
  const lastScanAt = useRef(0);

  const startWithPayload = useCallback(
    async (raw: string) => {
      setError("");
      setLoading(true);
      try {
        const { charger, connectorId } = await chargerService.validateQr(raw);
        await chargingService.startCharging(charger.id, connectorId, user?.id);
        navigation.replace("LiveSession");
      } catch (e) {
        if (e instanceof Error && e.message === "INVALID_QR") {
          setError(t("qr.invalidQr"));
          Alert.alert(t("common.error"), t("qr.invalidQr"));
        } else {
          showChargingErrorAlert(e, t, navigation);
        }
      } finally {
        setLoading(false);
        scanLock.current = false;
      }
    },
    [navigation, t, user?.id]
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
    setError("");
    setLoading(true);
    try {
      await chargingService.startCharging(route.params.chargerId!, defaultConnector, user?.id);
      navigation.replace("LiveSession");
    } catch (e) {
      showChargingErrorAlert(e, t, navigation);
    } finally {
      setLoading(false);
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
