-- Whether members of a private channel other than its owner may create invite links into it. Off
-- by default, so a private channel's owner decides who gets in unless they open it up.
ALTER TABLE channels
  ADD COLUMN members_can_invite boolean NOT NULL DEFAULT false;
