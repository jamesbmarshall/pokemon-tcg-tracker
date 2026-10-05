/**
 * Append-only list of schema migrations. Never edit a shipped entry; add a new one.
 * The updater takes a backup before starting a version that will apply new migrations.
 */
export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    recovery_codes TEXT,
    disabled INTEGER NOT NULL DEFAULT 0,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    prefs TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mfa_pending INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin','member')),
    note TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TEXT
  );

  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    clear_totp INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    ip TEXT,
    detail TEXT
  );
  CREATE INDEX audit_at ON audit_log(at);

  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('personal','shared')),
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX collections_owner ON collections(owner_id);

  CREATE TABLE collection_members (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
    added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, user_id)
  );
  CREATE INDEX members_user ON collection_members(user_id);

  CREATE TABLE entries (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    set_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    condition TEXT,
    notes TEXT,
    paid TEXT,
    added_at TEXT NOT NULL,
    updated_at TEXT,
    PRIMARY KEY (collection_id, id)
  );
  CREATE INDEX entries_card ON entries(card_id);

  CREATE TABLE wishlist (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, card_id)
  );

  CREATE TABLE notes (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, card_id)
  );

  CREATE TABLE graded (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    data TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (collection_id, id)
  );
  CREATE INDEX graded_card ON graded(card_id);

  CREATE TABLE graded_photos (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    graded_id TEXT NOT NULL,
    side TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    added_at TEXT NOT NULL
  );
  CREATE INDEX photos_graded ON graded_photos(collection_id, graded_id);

  CREATE TABLE value_history (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection_id, date)
  );

  CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX lists_collection ON lists(collection_id);

  CREATE TABLE list_cards (
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (list_id, card_id)
  );

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    set_id TEXT NOT NULL,
    data TEXT NOT NULL,
    priced INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL
  );

  CREATE TABLE set_stats (set_id TEXT PRIMARY KEY, master_total INTEGER NOT NULL, synced_at TEXT NOT NULL);

  CREATE TABLE http_cache (
    key TEXT PRIMARY KEY,
    status INTEGER NOT NULL,
    content_type TEXT,
    body BLOB NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE images (
    key TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    used_at INTEGER NOT NULL
  );

  CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    token_enc TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('collection','set','wishlist','graded','list')),
    target TEXT,
    audience TEXT NOT NULL CHECK (audience IN ('public','users','instance')),
    title TEXT,
    hide_paid INTEGER NOT NULL DEFAULT 1,
    hide_value INTEGER NOT NULL DEFAULT 0,
    hide_notes INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT
  );
  CREATE INDEX shares_owner ON shares(owner_id);

  CREATE TABLE share_users (
    share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (share_id, user_id)
  );
  CREATE INDEX share_users_user ON share_users(user_id);

  CREATE TABLE jobs (
    name TEXT PRIMARY KEY,
    last_started_at TEXT,
    last_finished_at TEXT,
    last_status TEXT,
    last_error TEXT,
    last_result TEXT
  );
  `,
];
