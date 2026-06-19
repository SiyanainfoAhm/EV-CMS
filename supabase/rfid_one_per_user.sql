-- One RFID card ↔ one user (at most one active binding each).
-- Run on VBDC after policies_write.sql

-- Keep oldest binding per user; unbind duplicates before unique index.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn
  FROM "EV_RFIDCards"
  WHERE user_id IS NOT NULL
)
UPDATE "EV_RFIDCards" c
SET user_id = NULL,
    status = CASE WHEN c.status = 'blocked' THEN 'blocked' ELSE 'inactive' END,
    updated_at = NOW()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_rfid_cards_one_user
  ON "EV_RFIDCards" (user_id)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bind_ev_rfid_to_user(p_card_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card "EV_RFIDCards"%ROWTYPE;
BEGIN
  IF p_card_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Card and user are required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO v_card FROM "EV_RFIDCards" WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID card not found';
  END IF;

  IF v_card.status = 'blocked' THEN
    RAISE EXCEPTION 'Cannot bind a blocked RFID card';
  END IF;

  IF v_card.user_id IS NOT NULL AND v_card.user_id <> p_user_id THEN
    RAISE EXCEPTION 'This RFID is already assigned to another user';
  END IF;

  -- Remove any other card from this user (1 user → 1 RFID).
  UPDATE "EV_RFIDCards"
  SET user_id = NULL,
      status = CASE WHEN status = 'blocked' THEN 'blocked' ELSE 'inactive' END,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND id <> p_card_id;

  UPDATE "EV_RFIDCards"
  SET user_id = p_user_id,
      status = 'active',
      updated_at = NOW()
  WHERE id = p_card_id;
END;
$$;

GRANT EXECUTE ON FUNCTION bind_ev_rfid_to_user(UUID, UUID) TO anon, authenticated;
