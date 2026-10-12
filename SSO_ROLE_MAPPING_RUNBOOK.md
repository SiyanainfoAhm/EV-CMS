# SSO role mapping deployment and verification

## Apply

Apply `supabase/migrations/20261012044315_sso_database_role_mapping.sql` to the target Supabase project using the approved deployment process.

## Verify the database mapping

```sql
SELECT employee_id, sso_sub, role, status
FROM "EV_Users"
ORDER BY employee_id;
```

The result must contain only these administrator subjects:

```text
102199 | 49b29e77-5a32-4816-a842-882a92e57e55 | SuperAdmin | active
900025 | a36f76cb-cef6-4b7b-9053-d5a54ab11dfd | SuperAdmin | active
900034 | cdab677d-fa11-480b-baf7-6806ade66186 | User | active
```

## Verify user linking

```sql
SELECT id, email, full_name, sso_sub, role, status
FROM "EV_Users"
WHERE sso_sub IS NOT NULL;
```

Both administrator subjects must be linked to active `EV_Users` records before testing login.

## Acceptance tests

Call the resolver with a verified test subject and employee code:

```sql
SELECT * FROM resolve_ev_user_for_sso(
  '<verified-sub>',
  '<employee-code>'
);
```

Expected behavior:

- The two approved subjects return `SuperAdmin`.
- Any other linked active subject returns `User`.
- Unknown subjects return no row and create `sso_login_denied` in `EV_AuditLogs`.
- Inactive users return no row and create `sso_login_denied` in `EV_AuditLogs`.
- Successful logins update `last_login_at` and create `sso_login` in `EV_AuditLogs`.
