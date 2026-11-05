import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, StyleSheet, Pressable, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../context/AuthContext';
import { adminCommand, type ManagedUser } from '../services/ssoAdminService';
import Header from '../components/Header';
import AppButton from '../components/AppButton';
import { confirmAction } from '../utils/confirm';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'SsoUsers'>;
export default function SsoUsersScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [subject, setSubject] = useState(''); const [role, setRole] = useState('User');
  const [status, setStatus] = useState('active'); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => { const result = await adminCommand<{users: ManagedUser[]}>('admin-users'); setUsers(result.users); };
  useEffect(() => { if (user?.role === 'SuperAdmin') load().catch(e => setMessage(e.message)); }, [user?.id]);
  if (user?.role !== 'SuperAdmin') return <Text>Administrator access required.</Text>;
  const select = (row?: ManagedUser) => {
    setSelected(row?.id || null); setName(row?.full_name || ''); setEmail(row?.email || '');
    setSubject(row?.sso_sub || ''); setRole(row?.role || 'User'); setStatus(row?.status || 'active'); setMessage('');
  };
  const save = async () => {
    setBusy(true); setMessage('');
    try { await adminCommand('admin-provision', { userId: selected, name, email, virtualId: subject.trim().toLowerCase(), role, status }); await load(); setMessage('Account saved. Existing sessions for this account have been revoked.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save account.'); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Header title="SSO user access" onBack={() => navigation.goBack()} />
    <Text>Approve users by linking their verified DFCCIL Virtual ID to an EV-CMS account.</Text>
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    <AppButton title="New account" disabled={busy} onPress={() => select()} variant="outline" />
    {users.map(row => <Pressable key={row.id} disabled={busy} onPress={() => select(row)} style={styles.row}>
      <Text>{row.full_name} · {row.role} · {row.status}</Text><Text>{row.email}</Text>
    </Pressable>)}
    <Text style={styles.title}>{selected ? 'Edit selected account' : 'Create an account'}</Text>
    <Text>Name</Text><TextInput accessibilityLabel="Name" style={styles.input} value={name} onChangeText={setName} editable={!selected && !busy} />
    <Text>Email</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" keyboardType="email-address" style={styles.input} value={email} onChangeText={setEmail} editable={!selected && !busy} />
    <Text>DFCCIL Virtual ID</Text><TextInput accessibilityLabel="DFCCIL Virtual ID" autoCapitalize="none" style={styles.input} value={subject} onChangeText={setSubject} editable={!busy} />
    <Text>Role</Text><View style={styles.choices}>{['User','SuperAdmin'].map(value => <AppButton key={value} title={value} disabled={busy} variant={role === value ? 'primary' : 'outline'} onPress={() => setRole(value)} />)}</View>
    <Text>Status</Text><View style={styles.choices}>{['active','inactive','suspended'].map(value => <AppButton key={value} title={value} disabled={busy} variant={status === value ? 'primary' : 'outline'} onPress={() => setStatus(value)} />)}</View>
    <AppButton title="Save access" loading={busy} disabled={!subject.trim()} onPress={() => confirmAction('Save SSO access', 'This changes account access and signs out its existing sessions.', 'Save', save)} />
    {selected ? <AppButton title="Sign out this user on all devices" variant="outline" disabled={busy} onPress={() => confirmAction('Revoke sessions', 'End all EV-CMS sessions for this user?', 'Sign out user', async () => {
      setBusy(true); try { await adminCommand('admin-revoke', {userId:selected}); setMessage('Sessions revoked.'); } catch(e) { setMessage(e instanceof Error ? e.message : 'Revocation failed.'); } finally { setBusy(false); }
    }, {destructive:true})} /> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({ page:{padding:20,gap:12,backgroundColor:colors.background}, input:{borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,color:colors.text}, row:{paddingVertical:12,borderBottomWidth:1,borderColor:colors.border}, choices:{flexDirection:'row',flexWrap:'wrap',gap:8}, title:{fontSize:20,fontWeight:'600',color:colors.text}, message:{color:colors.text,paddingVertical:8} });
