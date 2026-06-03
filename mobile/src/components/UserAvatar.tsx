import { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../theme/colors";
import { getInitials } from "../utils/initials";

interface Props {
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function UserAvatar({ name, avatarUrl, size = 44, loading = false, style }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  const initials = getInitials(name);
  const radius = size / 2;
  const fontSize = Math.round(size * 0.36);
  const showImage = Boolean(avatarUrl?.trim()) && !imageFailed;

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }, style]}>
      {showImage ? (
        <Image
          source={{ uri: avatarUrl!.trim() }}
          style={{ width: size, height: size, borderRadius: radius }}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: radius }]}>
          <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
        </View>
      )}
      {loading ? (
        <View style={[styles.overlay, { borderRadius: radius }]}>
          <ActivityIndicator color={colors.white} size="small" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", position: "relative" },
  fallback: {
    backgroundColor: colors.emeraldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { fontWeight: "700", color: colors.emerald },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17, 24, 39, 0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
});
