CREATE TABLE profiles (
    position INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL
);

INSERT INTO profiles (position, id, name, author_name, author_email) VALUES (1, 'default', 'Default', '', '');

CREATE TABLE profile_sessions (
    profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    session TEXT NOT NULL
);
