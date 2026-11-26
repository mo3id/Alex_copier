CREATE TABLE \"SystemSetting\" (
    \"id\" TEXT NOT NULL DEFAULT 'system',
    \"notificationsEnabled\" BOOLEAN NOT NULL DEFAULT false,
    \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \"SystemSetting_pkey\" PRIMARY KEY (\"id\")
);
INSERT INTO \"SystemSetting\" (\"id\", \"notificationsEnabled\", \"createdAt\", \"updatedAt\")
VALUES ('system', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (\"id\") DO NOTHING;
