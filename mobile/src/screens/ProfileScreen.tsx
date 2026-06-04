import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Alert, ScrollView } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import UserAvatar from "../components/UserAvatar";
import { useAuth } from "../context/AuthContext";
import * as profileService from "../services/profileService";
import * as mediaService from "../services/mediaService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { confirmAction } from "../utils/confirm";
import * as ImagePicker from "expo-image-picker";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export default function ProfileScreen({ navigation }: Props) {
  const { user, signOut, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    profileService
      .getProfile(user.id)
      .then((p) => {
        setName(p.name);
        setEmail(p.email);
        setPhone(p.phone ?? "");
        setAvatarUrl(p.avatarUrl ?? null);
      })
      .catch(() => {
        // use session user if RPC fails
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await profileService.updateProfile(user.id, { name, email, phone, avatarUrl });
      await refreshUser();
      setEditing(false);
      Alert.alert("Saved", "Profile updated in EV_Users");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    confirmAction(
      "Sign out",
      "Are you sure you want to sign out? You will need to sign in again to use the app.",
      "Sign out",
      () => signOut(),
      { subtitle: "End your session", destructive: true, icon: "⎋" }
    );
  };

  const pickAvatar = async () => {
    if (!user) return;
    setAvatarBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        throw new Error("Media permission is required to choose a profile picture.");
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) throw new Error("Invalid image selection");

      const url = await mediaService.replaceUserAvatar(user.id, asset.uri, asset.mimeType ?? null);
      await profileService.updateProfile(user.id, { name, email, phone, avatarUrl: url });
      setAvatarUrl(url);
      await refreshUser();
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not update profile picture");
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (!user) return;
    setAvatarBusy(true);
    try {
      await mediaService.deleteUserAvatar(user.id);
      await profileService.updateProfile(user.id, { name, email, phone, avatarUrl: null });
      setAvatarUrl(null);
      await refreshUser();
    } catch (e) {
      Alert.alert("Remove failed", e instanceof Error ? e.message : "Could not remove profile picture");
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Header title="Profile" onBack={() => navigation.goBack()} />
      <AppCard style={styles.card}>
        <View style={styles.avatarRow}>
          <UserAvatar name={name} avatarUrl={avatarUrl} size={72} loading={avatarBusy} />
          <View style={styles.avatarActions}>
            <AppButton title="Change photo" onPress={pickAvatar} disabled={avatarBusy} />
            {avatarUrl ? (
              <AppButton
                title="Remove photo"
                onPress={removeAvatar}
                variant="outline"
                disabled={avatarBusy}
                style={styles.smallButton}
              />
            ) : null}
          </View>
        </View>

        {editing ? (
          <>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} />
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </>
        ) : (
          <>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{email}</Text>
            <Text style={styles.role}>{user?.role}</Text>
            {phone ? <Text style={styles.phone}>{phone}</Text> : null}
            {user?.department ? <Text style={styles.phone}>{user.department}</Text> : null}
          </>
        )}
      </AppCard>
      {editing ? (
        <>
          <AppButton title="Save profile" onPress={save} loading={saving} style={styles.button} />
          <AppButton title="Cancel" onPress={() => setEditing(false)} variant="outline" style={styles.button} />
        </>
      ) : (
        <AppButton title="Edit profile" onPress={() => setEditing(true)} style={styles.button} />
      )}
      <AppButton title="Sign out" onPress={logout} variant="outline" style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.sm },
  button: { marginTop: spacing.sm },
  avatarRow: { flexDirection: "row", gap: spacing.md, alignItems: "center", marginBottom: spacing.md },
  avatarActions: { flex: 1 },
  smallButton: { marginTop: spacing.xs },
  name: { fontSize: 20, fontWeight: "700", color: colors.text },
  email: { color: colors.textMuted, marginTop: 6 },
  role: { color: colors.emerald, marginTop: 8, fontWeight: "600" },
  phone: { color: colors.textMuted, marginTop: 4 },
  label: { fontWeight: "600", color: colors.text, marginTop: spacing.sm, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.card,
    marginBottom: spacing.sm,
  },
});
