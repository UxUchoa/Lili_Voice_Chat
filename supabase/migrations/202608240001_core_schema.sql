begin;

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_path text,
  banner_path text,
  bio text not null default '' check (char_length(bio) <= 1000),
  pronouns text check (char_length(pronouns) <= 50),
  custom_status text check (char_length(custom_status) <= 128),
  presence text not null default 'offline' check (presence in ('online','idle','dnd','invisible','offline')),
  dm_policy text not null default 'FRIENDS' check (dm_policy in ('EVERYONE','FRIENDS','NOBODY')),
  friend_request_policy text not null default 'EVERYONE' check (friend_request_policy in ('EVERYONE','SERVER_MEMBERS','NOBODY')),
  profile_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  locale text not null default 'pt-BR',
  text_scale numeric(3,2) not null default 1 check (text_scale between .75 and 1.5),
  interface_zoom numeric(3,2) not null default 1 check (interface_zoom between .75 and 1.5),
  reduced_motion boolean not null default false,
  recovery_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  platform text not null,
  identity_public_key text not null,
  fingerprint text not null,
  verified_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_uidx on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.servers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 100),
  icon_path text,
  banner_path text,
  description text not null default '' check (char_length(description) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text check (char_length(nickname) <= 32),
  server_avatar_path text,
  join_source text,
  communication_disabled_until timestamptz,
  server_muted boolean not null default false,
  server_deafened boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index server_members_user_idx on public.server_members(user_id);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  position integer not null default 0,
  permissions bigint not null default 0 check (permissions >= 0),
  color text not null default '#817b7f',
  secondary_color text,
  icon_path text,
  unicode_emoji text,
  hoist boolean not null default false,
  mentionable boolean not null default false,
  is_default boolean not null default false,
  managed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index roles_everyone_uidx on public.roles(server_id) where is_default;
create unique index roles_position_uidx on public.roles(server_id, position);

create table public.member_roles (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id, role_id),
  foreign key (server_id, user_id) references public.server_members(server_id, user_id) on delete cascade
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references public.servers(id) on delete cascade,
  parent_id uuid references public.channels(id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('category','text','voice','dm','gdm','thread')),
  position integer not null default 0,
  topic text check (char_length(topic) <= 1024),
  slowmode_seconds integer not null default 0 check (slowmode_seconds between 0 and 21600),
  user_limit integer not null default 0 check (user_limit between 0 and 1000),
  private boolean not null default false,
  permissions_synced boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind in ('dm','gdm') and server_id is null) or (kind not in ('dm','gdm') and server_id is not null))
);
create index channels_server_position_idx on public.channels(server_id, position);

create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on public.channel_members(user_id);

create table public.channel_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  target_type text not null check (target_type in ('ROLE','MEMBER')),
  target_id uuid not null,
  allow_mask bigint not null default 0 check (allow_mask >= 0),
  deny_mask bigint not null default 0 check (deny_mask >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, target_type, target_id),
  check ((allow_mask & deny_mask) = 0)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  sender_device_id uuid not null references public.devices(id),
  ciphertext text not null,
  nonce text not null,
  payload_version smallint not null default 1 check (payload_version > 0),
  mls_epoch integer not null check (mls_epoch > 0),
  reply_to_id uuid references public.messages(id) on delete set null,
  mention_recipient_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (char_length(ciphertext) <= 131072),
  check (coalesce(array_length(mention_recipient_ids, 1), 0) <= 100)
);
create index messages_channel_created_idx on public.messages(channel_id, created_at desc);
create index messages_author_idx on public.messages(author_id);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  storage_object text not null unique,
  ciphertext_size bigint not null check (ciphertext_size between 1 and 26214400),
  ciphertext_hash text not null,
  created_at timestamptz not null default now()
);

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 128),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table public.message_pins (
  message_id uuid primary key references public.messages(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id),
  pinned_at timestamptz not null default now()
);

create table public.read_states (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_message_id uuid references public.messages(id) on delete set null,
  last_read_at timestamptz not null default now(),
  mention_count integer not null default 0 check (mention_count >= 0),
  primary key (channel_id, user_id)
);

create table public.bans (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  reason text check (char_length(reason) <= 512),
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  server_id uuid not null references public.servers(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  creator_id uuid not null references public.profiles(id),
  max_uses integer check (max_uses between 1 and 100000),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action_type text not null,
  target_type text not null,
  target_id uuid,
  reason text check (char_length(reason) <= 512),
  changes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_server_created_idx on public.audit_logs(server_id, created_at desc);

create table public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope_type text not null check (scope_type in ('GLOBAL','SERVER','CHANNEL')),
  scope_id text not null,
  mode text not null check (mode in ('ALL','MENTIONS','NONE')),
  suppress_everyone boolean not null default false,
  suppress_roles boolean not null default false,
  muted_until timestamptz,
  unique (user_id, scope_type, scope_id)
);

create table public.e2ee_key_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  cipher_suite integer not null,
  key_package text not null,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index e2ee_key_packages_available_idx on public.e2ee_key_packages(user_id, consumed_at, expires_at);

create table public.channel_key_envelopes (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_device_id uuid not null references public.devices(id) on delete cascade,
  epoch integer not null check (epoch > 0),
  envelope text not null,
  created_at timestamptz not null default now(),
  unique (channel_id, recipient_device_id, epoch)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_envelopes (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  event_type text not null default 'MENTION' check (event_type in ('MENTION','MESSAGE','CALL')),
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, message_id, event_type)
);

create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  room_name text not null unique,
  e2ee_epoch integer not null default 1,
  created_by uuid not null references public.profiles(id),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

commit;
