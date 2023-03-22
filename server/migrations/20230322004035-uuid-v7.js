// code for this comes from: https://gist.github.com/kjmph/5bd772b2c2df145aa645b837da7eca74

exports.up = async function (db) {
  await db.runSql(`
/**
 * Returns a time-ordered UUID (UUIDv7).
 *
 * Tags: uuid guid uuid-generator guid-generator generator time order rfc4122 rfc-4122
 */
create or replace function sb_uuid()
returns uuid
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms = substring(
    int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);

  -- use random v4 uuid as starting point (which has the same variant we need)
  uuid_bytes = uuid_send(gen_random_uuid());

  -- overlay timestamp
  uuid_bytes = overlay(uuid_bytes placing unix_ts_ms from 1 for 6);

  -- set version 7
  uuid_bytes = set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);

  return encode(uuid_bytes, 'hex')::uuid;
end
$$
language plpgsql
volatile;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
/**
 * Returns a time-ordered UUID (UUIDv6).
 *
 * Tags: uuid guid uuid-generator guid-generator generator time order rfc4122 rfc-4122
 */
create or replace function sb_uuid() returns uuid as $$
declare
  v_time timestamp with time zone:= null;
  v_secs bigint := null;
  v_usec bigint := null;

  v_timestamp bigint := null;
  v_timestamp_hex varchar := null;

  v_clkseq_and_nodeid bigint := null;
  v_clkseq_and_nodeid_hex varchar := null;

  v_bytes bytea;

  c_epoch bigint := -12219292800; -- RFC-4122 epoch: '1582-10-15 00:00:00'
  c_variant bit(64):= x'8000000000000000'; -- RFC-4122 variant: b'10xx...'
begin

  -- Get seconds and micros
  v_time := clock_timestamp();
  v_secs := EXTRACT(EPOCH FROM v_time);
  v_usec := mod(EXTRACT(MICROSECONDS FROM v_time)::numeric, 10^6::numeric);

  -- Generate timestamp hexadecimal (and set version 6)
  v_timestamp := (((v_secs - c_epoch) * 10^6) + v_usec) * 10;
  v_timestamp_hex := lpad(to_hex(v_timestamp), 16, '0');
  v_timestamp_hex := substr(v_timestamp_hex, 2, 12) || '6' || substr(v_timestamp_hex, 14, 3);

  -- Generate clock sequence and node identifier hexadecimal (and set variant b'10xx')
  v_clkseq_and_nodeid := ((random()::numeric * 2^62::numeric)::bigint::bit(64) | c_variant)::bigint;
  v_clkseq_and_nodeid_hex := lpad(to_hex(v_clkseq_and_nodeid), 16, '0');

  -- Concat timestemp, clock sequence and node identifier hexadecimal
  v_bytes := decode(v_timestamp_hex || v_clkseq_and_nodeid_hex, 'hex');

  return encode(v_bytes, 'hex')::uuid;

end $$ language plpgsql;

-- EXAMPLE:
--
-- select sb_uuid() uuid, clock_timestamp()-statement_timestamp() time_taken;

-- EXAMPLE OUTPUT:
--
-- |uuid                                  |time_taken        |
-- |--------------------------------------|------------------|
-- |1ed58ca7-060a-62a0-aa64-951dd4e5bb8a  |00:00:00.000104   |

-------------------------------------------------------------------
-- FOR TEST: the expected result is an empty result set
-------------------------------------------------------------------
-- with t as (
--     select sb_uuid() as id from generate_series(1, 1000)
-- )
-- select * from t
-- where (id is null or
--  id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-6[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$');
  `)
}

exports._meta = {
  version: 1,
}
