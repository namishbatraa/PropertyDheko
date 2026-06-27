-- Add USERS table for authentication
USE property_mgmt;

CREATE TABLE IF NOT EXISTS USERS (
    User_ID     INT             AUTO_INCREMENT PRIMARY KEY,
    Username    VARCHAR(100)    NOT NULL,
    Email       VARCHAR(150)    NOT NULL,
    Password    VARCHAR(255)    NOT NULL,
    Role        ENUM('tenant','owner','agent') NOT NULL,
    Ref_ID      INT             NULL,  -- FK to TENANT/OWNER/AGENT table
    Created_At  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_email    UNIQUE (Email),
    CONSTRAINT uq_user_username UNIQUE (Username)
);
