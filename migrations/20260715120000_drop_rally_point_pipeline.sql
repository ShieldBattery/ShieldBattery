-- Removes the v1 rally-point networking pipeline. Netcode v2 replaced in-game networking (relay
-- sessions instead of direct player-to-player routes), and matchmaking's latency input was
-- replaced by game server regions -- nothing creates rally-point routes or reads pings from these
-- servers anymore.
DROP TABLE rally_point_servers;

-- The admin permission that gated managing the (now-removed) rally-point server registry.
ALTER TABLE permissions DROP COLUMN manage_rally_point_servers;

-- The per-game route/latency debug data this fed (used only to debug v1 rally-point routes). No
-- game past the netcode v2 cutover has ever had a non-empty value here, and no code reads or
-- writes it anymore.
ALTER TABLE games DROP COLUMN routes;
