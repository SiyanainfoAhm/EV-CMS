import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useTranslation } from "react-i18next";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  onScan: (data: string) => void;
  active?: boolean;
}

export default function QrCameraScanner({ onScan, active = true }: Props) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (active) setScanned(false);
  }, [active]);

  if (!permission) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.hint}>{t("common.loading")}</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.hint}>{t("qr.permissionRequired")}</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>{t("common.confirm")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          active && !scanned
            ? ({ data }) => {
                setScanned(true);
                onScan(data);
              }
            : undefined
        }
      />
      <Text style={styles.overlay}>{t("qr.scanHint")}</Text>
      {scanned ? (
        <Pressable style={styles.rescan} onPress={() => setScanned(false)}>
          <Text style={styles.rescanText}>{t("qr.scanAgain")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: "hidden", marginBottom: spacing.sm },
  camera: { width: "100%", height: 220 },
  overlay: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    textAlign: "center",
    color: colors.white,
    fontSize: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 6,
    borderRadius: 8,
  },
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
  hint: { color: colors.textMuted, textAlign: "center", marginBottom: spacing.sm },
  button: {
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  buttonText: { color: colors.white, fontWeight: "600" },
  rescan: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: colors.navy,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rescanText: { color: colors.white, fontSize: 12, fontWeight: "600" },
});
