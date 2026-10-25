CREATE TABLE user_moderation_batches (
  batch_hour TIMESTAMPTZ PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  CHECK (batch_hour = date_bin(INTERVAL '1 hour', batch_hour,
    TIMESTAMPTZ '1970-01-01 00:00:00+00')),
  CHECK (starts_at > batch_hour AND starts_at <= batch_hour + INTERVAL '10 minutes')
);

-- A batch shares one persisted random offset, including across services and restarts.
-- Rounding after the minimum hold prevents an early batch from shortening that hold.
CREATE FUNCTION moderation_action_not_before(assessed_at TIMESTAMPTZ)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  earliest TIMESTAMPTZ := assessed_at + INTERVAL '30 minutes';
  batch TIMESTAMPTZ;
  result TIMESTAMPTZ;
BEGIN
  batch := date_bin(INTERVAL '1 hour', earliest, TIMESTAMPTZ '1970-01-01 00:00:00+00');
  IF batch < earliest THEN
    batch := batch + INTERVAL '1 hour';
  END IF;
  INSERT INTO user_moderation_batches AS existing (batch_hour, starts_at)
  VALUES (batch, batch + (1 + floor(random() * 600000)) * INTERVAL '1 millisecond')
  ON CONFLICT (batch_hour) DO UPDATE SET starts_at = existing.starts_at
  RETURNING starts_at INTO result;
  RETURN result;
END;
$$;
