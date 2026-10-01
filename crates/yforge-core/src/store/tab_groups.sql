CREATE TABLE session_groups (
    position INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    collapsed INTEGER NOT NULL CHECK (collapsed IN (0, 1))
);

ALTER TABLE session_tabs ADD COLUMN group_position INTEGER REFERENCES session_groups (position);
