-- ============================================================
--  Property Management System — MySQL Schema
--  Database : property_mgmt
--  Credentials: root / shashank @ localhost:3306
-- ============================================================

CREATE DATABASE IF NOT EXISTS property_mgmt
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE property_mgmt;

-- --------------------------------------------------------
-- 1. AGENT
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS AGENT (
    Agent_ID        INT             AUTO_INCREMENT PRIMARY KEY,
    Name            VARCHAR(100)    NOT NULL,
    Phone           VARCHAR(20)     NOT NULL,
    Commission_Rate DECIMAL(5,2)    NOT NULL,
    CONSTRAINT chk_commission CHECK (Commission_Rate BETWEEN 0 AND 25),
    CONSTRAINT uq_agent_phone UNIQUE (Phone)
);

-- --------------------------------------------------------
-- 2. OWNER
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS OWNER (
    Owner_ID    INT             AUTO_INCREMENT PRIMARY KEY,
    Name        VARCHAR(100)    NOT NULL,
    Phone       VARCHAR(20)     NOT NULL,
    Email       VARCHAR(150)    NOT NULL,
    CONSTRAINT uq_owner_email  UNIQUE (Email),
    CONSTRAINT uq_owner_phone  UNIQUE (Phone)
);

-- --------------------------------------------------------
-- 3. TENANT
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS TENANT (
    Tenant_ID   INT             AUTO_INCREMENT PRIMARY KEY,
    Name        VARCHAR(100)    NOT NULL,
    Phone       VARCHAR(20)     NOT NULL,
    Email       VARCHAR(150)    NOT NULL,
    CONSTRAINT uq_tenant_email UNIQUE (Email),
    CONSTRAINT uq_tenant_phone UNIQUE (Phone)
);

-- --------------------------------------------------------
-- 4. AMENITY
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS AMENITY (
    Amenity_ID      INT             AUTO_INCREMENT PRIMARY KEY,
    Amenity_Name    VARCHAR(100)    NOT NULL
);

-- --------------------------------------------------------
-- 5. PROPERTY
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS PROPERTY (
    Property_ID     INT             AUTO_INCREMENT PRIMARY KEY,
    Title           VARCHAR(200)    NOT NULL,
    Type            VARCHAR(50)     NOT NULL,
    Location        VARCHAR(255)    NOT NULL,
    Price           DECIMAL(14,2)   NOT NULL,
    Status          VARCHAR(20)     NOT NULL DEFAULT 'Available',
    AI_Est_Price    DECIMAL(14,2)   NULL,
    Owner_ID        INT             NOT NULL,
    Agent_ID        INT             NOT NULL,
    CONSTRAINT fk_property_owner  FOREIGN KEY (Owner_ID)  REFERENCES OWNER(Owner_ID)  ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_property_agent  FOREIGN KEY (Agent_ID)  REFERENCES AGENT(Agent_ID)  ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_price          CHECK (Price > 0),
    CONSTRAINT chk_status         CHECK (Status IN ('Available','Sold','Rented','Pending'))
);

-- --------------------------------------------------------
-- 6. PROPERTY_AMENITY  (M:N junction)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS PROPERTY_AMENITY (
    Property_ID     INT NOT NULL,
    Amenity_ID      INT NOT NULL,
    PRIMARY KEY (Property_ID, Amenity_ID),
    CONSTRAINT fk_pa_property FOREIGN KEY (Property_ID) REFERENCES PROPERTY(Property_ID) ON DELETE CASCADE,
    CONSTRAINT fk_pa_amenity  FOREIGN KEY (Amenity_ID)  REFERENCES AMENITY(Amenity_ID)  ON DELETE CASCADE
);

-- --------------------------------------------------------
-- 7. INQUIRY
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS INQUIRY (
    Inquiry_ID      INT             AUTO_INCREMENT PRIMARY KEY,
    Message         TEXT            NOT NULL,
    Date            DATE            NOT NULL,
    Status          VARCHAR(20)     NOT NULL DEFAULT 'New',
    Tenant_ID       INT             NOT NULL,
    Property_ID     INT             NOT NULL,
    Agent_ID        INT             NOT NULL,
    CONSTRAINT fk_inquiry_tenant   FOREIGN KEY (Tenant_ID)   REFERENCES TENANT(Tenant_ID)   ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_inquiry_property FOREIGN KEY (Property_ID) REFERENCES PROPERTY(Property_ID) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_inquiry_agent    FOREIGN KEY (Agent_ID)    REFERENCES AGENT(Agent_ID)    ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_inquiry_status  CHECK (Status IN ('New','Responded','Closed'))
);

-- --------------------------------------------------------
-- 8. AGENT_INQUIRY  (Agent ↔ Inquiry junction)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS AGENT_INQUIRY (
    Agent_ID    INT NOT NULL,
    Inquiry_ID  INT NOT NULL,
    PRIMARY KEY (Agent_ID, Inquiry_ID),
    CONSTRAINT fk_ai_agent   FOREIGN KEY (Agent_ID)   REFERENCES AGENT(Agent_ID)   ON DELETE CASCADE,
    CONSTRAINT fk_ai_inquiry FOREIGN KEY (Inquiry_ID) REFERENCES INQUIRY(Inquiry_ID) ON DELETE CASCADE
);

-- --------------------------------------------------------
-- 9. LEASE
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS LEASE (
    Lease_ID            INT             AUTO_INCREMENT PRIMARY KEY,
    Start_Date          DATE            NOT NULL,
    End_Date            DATE            NOT NULL,
    Monthly_Rent        DECIMAL(12,2)   NOT NULL,
    Security_Deposit    DECIMAL(12,2)   NOT NULL DEFAULT 0,
    Property_ID         INT             NOT NULL,
    CONSTRAINT fk_lease_property    FOREIGN KEY (Property_ID) REFERENCES PROPERTY(Property_ID) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_lease_dates      CHECK (End_Date > Start_Date),
    CONSTRAINT chk_monthly_rent     CHECK (Monthly_Rent > 0)
);

-- --------------------------------------------------------
-- 10. TENANT_LEASE  (Tenant ↔ Lease junction)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS TENANT_LEASE (
    Tenant_ID   INT NOT NULL,
    Lease_ID    INT NOT NULL,
    PRIMARY KEY (Tenant_ID, Lease_ID),
    CONSTRAINT fk_tl_tenant FOREIGN KEY (Tenant_ID) REFERENCES TENANT(Tenant_ID) ON DELETE CASCADE,
    CONSTRAINT fk_tl_lease  FOREIGN KEY (Lease_ID)  REFERENCES LEASE(Lease_ID)   ON DELETE CASCADE
);

-- --------------------------------------------------------
-- 11. PAYMENT
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS PAYMENT (
    Payment_ID      INT             AUTO_INCREMENT PRIMARY KEY,
    Payment_Date    DATE            NOT NULL,
    Amount          DECIMAL(12,2)   NOT NULL,
    Method          VARCHAR(50)     NOT NULL,
    Status          VARCHAR(20)     NOT NULL DEFAULT 'Pending',
    Lease_ID        INT             NOT NULL,
    CONSTRAINT fk_payment_lease FOREIGN KEY (Lease_ID) REFERENCES LEASE(Lease_ID) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payment_amount CHECK (Amount > 0),
    CONSTRAINT chk_payment_status CHECK (Status IN ('Success','Failed','Pending'))
);
