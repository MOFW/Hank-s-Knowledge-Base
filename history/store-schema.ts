export const HISTORY_APPLICATION_ID = 0x484b4248;
export const HISTORY_SCHEMA_VERSION = 1;

export const historySchema = `
  CREATE TABLE history_exports (
    digest TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('zip', 'json')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed')),
    completed_seq INTEGER UNIQUE,
    error_code TEXT,
    error_entry_path TEXT,
    conversations INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    new_messages INTEGER NOT NULL DEFAULT 0,
    reused_messages INTEGER NOT NULL DEFAULT 0,
    changed_messages INTEGER NOT NULL DEFAULT 0,
    issues INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE history_checkpoints (
    digest TEXT NOT NULL REFERENCES history_exports(digest),
    entry_path TEXT NOT NULL,
    next_ordinal INTEGER NOT NULL,
    PRIMARY KEY (digest, entry_path)
  ) STRICT;

  CREATE TABLE history_conversation_observations (
    id INTEGER PRIMARY KEY,
    digest TEXT NOT NULL REFERENCES history_exports(digest),
    entry_path TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    raw_path TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    conversation_id TEXT,
    title TEXT,
    search_title TEXT NOT NULL,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    current_node_id TEXT,
    UNIQUE (digest, entry_path, ordinal)
  ) STRICT;
  CREATE INDEX history_conversation_observations_by_conversation
    ON history_conversation_observations(conversation_id, digest);

  CREATE TABLE history_sources (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    UNIQUE (conversation_id, message_id)
  ) STRICT;

  CREATE TABLE history_revisions (
    source_id TEXT NOT NULL REFERENCES history_sources(id),
    hash TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    message_date TEXT,
    body TEXT NOT NULL,
    search_body TEXT NOT NULL,
    content_type TEXT,
    PRIMARY KEY (source_id, hash)
  ) STRICT;

  CREATE TABLE history_nodes (
    id INTEGER PRIMARY KEY,
    observation_id INTEGER NOT NULL REFERENCES history_conversation_observations(id),
    node_id TEXT NOT NULL,
    parent_node_id TEXT,
    child_node_ids TEXT NOT NULL,
    node_ordinal INTEGER NOT NULL,
    on_current_branch INTEGER NOT NULL CHECK (on_current_branch IN (0, 1)),
    raw_path TEXT NOT NULL,
    message_path TEXT,
    source_id TEXT,
    revision_hash TEXT,
    attachments TEXT NOT NULL,
    has_image INTEGER NOT NULL CHECK (has_image IN (0, 1)),
    has_missing INTEGER NOT NULL CHECK (has_missing IN (0, 1)),
    CHECK ((source_id IS NULL) = (revision_hash IS NULL)),
    FOREIGN KEY (source_id, revision_hash) REFERENCES history_revisions(source_id, hash),
    UNIQUE (observation_id, node_id),
    UNIQUE (observation_id, node_ordinal)
  ) STRICT;
  CREATE INDEX history_nodes_by_source ON history_nodes(source_id, id);
  CREATE INDEX history_nodes_by_revision ON history_nodes(source_id, revision_hash);

  CREATE TABLE history_export_sources (
    digest TEXT NOT NULL REFERENCES history_exports(digest),
    source_id TEXT NOT NULL REFERENCES history_sources(id),
    node_row_id INTEGER NOT NULL REFERENCES history_nodes(id),
    PRIMARY KEY (digest, source_id)
  ) STRICT;

  CREATE TABLE history_export_conversations (
    digest TEXT NOT NULL REFERENCES history_exports(digest),
    conversation_id TEXT NOT NULL,
    observation_id INTEGER NOT NULL REFERENCES history_conversation_observations(id),
    PRIMARY KEY (digest, conversation_id)
  ) STRICT;

  CREATE TABLE history_current_sources (
    source_id TEXT PRIMARY KEY REFERENCES history_sources(id),
    node_row_id INTEGER NOT NULL REFERENCES history_nodes(id)
  ) STRICT;

  CREATE TABLE history_current_conversations (
    conversation_id TEXT PRIMARY KEY,
    observation_id INTEGER NOT NULL REFERENCES history_conversation_observations(id)
  ) STRICT;

  CREATE TABLE history_issues (
    id INTEGER PRIMARY KEY,
    observation_id INTEGER NOT NULL REFERENCES history_conversation_observations(id),
    digest TEXT NOT NULL REFERENCES history_exports(digest),
    code TEXT NOT NULL,
    raw_path TEXT NOT NULL
  ) STRICT;
  CREATE INDEX history_issues_by_export ON history_issues(digest, id);

  CREATE TABLE history_tags (
    conversation_id TEXT NOT NULL REFERENCES history_current_conversations(conversation_id),
    kind TEXT NOT NULL CHECK (kind IN ('course', 'topic')),
    label TEXT NOT NULL,
    search_label TEXT NOT NULL,
    PRIMARY KEY (conversation_id, kind, search_label)
  ) STRICT;
  CREATE INDEX history_tags_by_label ON history_tags(kind, search_label, conversation_id);

  CREATE TABLE history_batches (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    label TEXT,
    selection TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE history_batch_items (
    batch_id TEXT NOT NULL REFERENCES history_batches(id),
    position INTEGER NOT NULL,
    node_row_id INTEGER NOT NULL REFERENCES history_nodes(id),
    PRIMARY KEY (batch_id, position)
  ) STRICT;
`;
