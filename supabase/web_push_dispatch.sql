-- Dispatch mobile (Expo) and web (FCM) push when a notification row is inserted.
-- Prerequisite: deploy send-push-notification edge function + set secrets (see WEB_PUSH_SETUP.md).

CREATE OR REPLACE FUNCTION ev_dispatch_push_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT := 'https://fvveqziyusjgqejowkfp.supabase.co/functions/v1/send-push-notification';
  v_secret TEXT;
BEGIN
  IF NEW.push_sent = true THEN
    RETURN NEW;
  END IF;

  v_secret := ev_get_system_config('ev_push_dispatch_secret');
  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ev-push-secret', v_secret
    ),
    body := jsonb_build_object('notificationId', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_notifications_dispatch_push ON "EV_Notifications";
CREATE TRIGGER ev_notifications_dispatch_push
  AFTER INSERT ON "EV_Notifications"
  FOR EACH ROW
  EXECUTE FUNCTION ev_dispatch_push_notification();

-- Secret is stored in EV_SystemConfig (see supabase/ev_system_config.sql).
-- Optional override: EV_PUSH_DISPATCH_SECRET edge function secret.
