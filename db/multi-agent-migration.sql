-- ============================================================
--  PropVault — Multi-Agent & Commission Migration
--  Database : property_mgmt
--  Run ONCE after integrity-migration.sql.
--
--  Changes:
--    1. AMENITY uniqueness: no change to global constraint.
--       Duplicate amenities within the SAME property are already
--       prevented by the PRIMARY KEY (Property_ID, Amenity_ID)
--       on the PROPERTY_AMENITY table — no extra trigger needed.
--    2. Create PROPERTY_AGENT junction table (one property → many agents).
--    3. Migrate existing PROPERTY.Agent_ID → PROPERTY_AGENT (Is_Primary=1).
--    4. Drop PROPERTY.Agent_ID column.
--    5. Add PROPERTY.first_lease_id (commission tracking).
--    6. Stored procedure sp_assign_agent — row-locked agent assignment.
--    7. Trigger: trg_inquiry_before_insert (updated for multi-agent).
--    8. Trigger: trg_lease_after_insert_commission (sets first_lease_id).
-- ============================================================
USE property_mgmt;

-- ────────────────────────────────────────────────────────────
-- STEP 1: AMENITY uniqueness — NO CHANGE NEEDED
--
-- Rule: the same amenity must NOT be added twice to the same property.
--       This is already enforced by the composite PRIMARY KEY on
--       PROPERTY_AMENITY (Property_ID, Amenity_ID).
--       The database will reject any duplicate row with a PK error.
--
--       Different properties CAN and SHOULD share amenity names
--       (e.g. both Property 1 and Property 2 can have "Gym").
--       The global AMENITY.Amenity_Name unique index (uq_amenity_name)
--       is intentionally left in place so the amenity catalogue
--       doesn't accumulate duplicate names.
--
-- Application note: use INSERT IGNORE INTO PROPERTY_AMENITY
-- to silently skip if the same amenity is submitted twice for
-- the same property.
-- ────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────
-- STEP 2: Create PROPERTY_AGENT junction table
--         PRIMARY KEY (Property_ID, Agent_ID) prevents duplicates
--         and is itself the uniqueness lock.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS PROPERTY_AGENT (
    Property_ID  INT          NOT NULL,
    Agent_ID     INT          NOT NULL,
    Is_Primary   TINYINT(1)   NOT NULL DEFAULT 0,
    Assigned_At  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (Property_ID, Agent_ID),
    CONSTRAINT fk_pa_property2 FOREIGN KEY (Property_ID) REFERENCES PROPERTY(Property_ID) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_pa_agent2    FOREIGN KEY (Agent_ID)    REFERENCES AGENT(Agent_ID)       ON UPDATE CASCADE ON DELETE CASCADE
);


-- ────────────────────────────────────────────────────────────
-- STEP 3: Migrate existing single-agent data → PROPERTY_AGENT
--         Only runs if PROPERTY.Agent_ID column still exists.
-- ────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS _migrate_agent_ids;
DELIMITER $$
CREATE PROCEDURE _migrate_agent_ids()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'property_mgmt'
      AND TABLE_NAME   = 'PROPERTY'
      AND COLUMN_NAME  = 'Agent_ID'
  ) THEN
    INSERT IGNORE INTO PROPERTY_AGENT (Property_ID, Agent_ID, Is_Primary)
    SELECT Property_ID, Agent_ID, 1
    FROM PROPERTY
    WHERE Agent_ID IS NOT NULL;
  END IF;
END$$
DELIMITER ;
CALL _migrate_agent_ids();
DROP PROCEDURE IF EXISTS _migrate_agent_ids;


-- ────────────────────────────────────────────────────────────
-- STEP 4: Add first_lease_id to PROPERTY for commission tracking.
-- ────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS _add_first_lease_col;
DELIMITER $$
CREATE PROCEDURE _add_first_lease_col()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'property_mgmt'
      AND TABLE_NAME   = 'PROPERTY'
      AND COLUMN_NAME  = 'first_lease_id'
  ) THEN
    ALTER TABLE PROPERTY
      ADD COLUMN first_lease_id INT NULL DEFAULT NULL
        COMMENT 'Lease_ID of the first-ever lease. Agent commission applies only to payments on this lease.';
  END IF;
END$$
DELIMITER ;
CALL _add_first_lease_col();
DROP PROCEDURE IF EXISTS _add_first_lease_col;

-- Back-fill for existing properties that already have leases
UPDATE PROPERTY p
  JOIN (
    SELECT Property_ID, MIN(Lease_ID) AS min_lease
    FROM LEASE
    GROUP BY Property_ID
  ) fl ON fl.Property_ID = p.Property_ID
SET p.first_lease_id = fl.min_lease
WHERE p.first_lease_id IS NULL;



-- ────────────────────────────────────────────────────────────
-- STEP 5: Drop PROPERTY.Agent_ID FK + column
-- ────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS _drop_agent_fk_col;
DELIMITER $$
CREATE PROCEDURE _drop_agent_fk_col()
BEGIN
  -- Drop FK if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = 'property_mgmt'
      AND TABLE_NAME        = 'PROPERTY'
      AND CONSTRAINT_NAME   = 'fk_property_agent'
      AND CONSTRAINT_TYPE   = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE PROPERTY DROP FOREIGN KEY fk_property_agent;
  END IF;

  -- Drop the column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'property_mgmt'
      AND TABLE_NAME   = 'PROPERTY'
      AND COLUMN_NAME  = 'Agent_ID'
  ) THEN
    ALTER TABLE PROPERTY DROP COLUMN Agent_ID;
  END IF;
END$$
DELIMITER ;
CALL _drop_agent_fk_col();
DROP PROCEDURE IF EXISTS _drop_agent_fk_col;


-- ────────────────────────────────────────────────────────────
-- STEP 6: Stored Procedure — sp_assign_agent
--
--  Safely assigns an agent to a property with row-level locking.
--  Two concurrent calls for the same (Property_ID, Agent_ID)
--  will serialize: the second one sees the already-inserted row
--  and returns a friendly error instead of a duplicate key crash.
--
--  Usage:
--    CALL sp_assign_agent(property_id, agent_id, is_primary);
-- ────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS sp_assign_agent;

DELIMITER $$

CREATE PROCEDURE sp_assign_agent(
    IN  p_property_id INT,
    IN  p_agent_id    INT,
    IN  p_is_primary  TINYINT(1)
)
BEGIN
    DECLARE v_prop_status  VARCHAR(20);
    DECLARE v_already_assigned INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Lock the property row exclusively so no concurrent assignment
    -- or status change can interleave.
    SELECT Status INTO v_prop_status
    FROM PROPERTY
    WHERE Property_ID = p_property_id
    FOR UPDATE;

    IF v_prop_status IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Property not found.';
    END IF;

    IF v_prop_status = 'Sold' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot assign agent: property is already Sold.';
    END IF;

    -- Check if this agent is already assigned (re-read under lock)
    SELECT COUNT(*) INTO v_already_assigned
    FROM PROPERTY_AGENT
    WHERE Property_ID = p_property_id
      AND Agent_ID    = p_agent_id;

    IF v_already_assigned > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Agent is already assigned to this property.';
    END IF;

    -- If making this agent primary, demote any existing primary
    IF p_is_primary = 1 THEN
        UPDATE PROPERTY_AGENT
        SET Is_Primary = 0
        WHERE Property_ID = p_property_id;
    END IF;

    INSERT INTO PROPERTY_AGENT (Property_ID, Agent_ID, Is_Primary)
    VALUES (p_property_id, p_agent_id, p_is_primary);

    COMMIT;
END$$

DELIMITER ;


-- ────────────────────────────────────────────────────────────
-- STEP 7: Drop & recreate triggers that referenced PROPERTY.Agent_ID
-- ────────────────────────────────────────────────────────────

-- Drop old versions
DROP TRIGGER IF EXISTS trg_inquiry_before_insert;
DROP TRIGGER IF EXISTS trg_lease_after_insert;
DROP TRIGGER IF EXISTS trg_property_amenity_before_insert;

DELIMITER $$

-- (No amenity trigger needed — PK on PROPERTY_AMENITY handles
--  duplicate amenity prevention within a single property.)



-- ── TRIGGER B: INQUIRY — validate agent is assigned to property ──
-- Agent_ID in INQUIRY must exist in PROPERTY_AGENT for that property.
CREATE TRIGGER trg_inquiry_before_insert
BEFORE INSERT ON INQUIRY
FOR EACH ROW
BEGIN
    DECLARE v_assigned        INT DEFAULT 0;
    DECLARE v_corrected_agent INT DEFAULT NULL;

    SELECT COUNT(*) INTO v_assigned
    FROM PROPERTY_AGENT
    WHERE Property_ID = NEW.Property_ID
      AND Agent_ID    = NEW.Agent_ID;

    IF v_assigned = 0 THEN
        -- Auto-correct: try primary agent first
        SELECT Agent_ID INTO v_corrected_agent
        FROM PROPERTY_AGENT
        WHERE Property_ID = NEW.Property_ID
          AND Is_Primary   = 1
        LIMIT 1;

        -- Fall back to any assigned agent
        IF v_corrected_agent IS NULL THEN
            SELECT Agent_ID INTO v_corrected_agent
            FROM PROPERTY_AGENT
            WHERE Property_ID = NEW.Property_ID
            LIMIT 1;
        END IF;

        IF v_corrected_agent IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Inquiry rejected: no agent assigned to this property.';
        END IF;

        SET NEW.Agent_ID = v_corrected_agent;
    END IF;
END$$


-- ── TRIGGER C: LEASE AFTER INSERT — set first_lease_id once ───
-- Only sets first_lease_id if this is the first lease ever for the property.
-- This is what gates agent commission: subsequent leases don't update it.
CREATE TRIGGER trg_lease_after_insert_commission
AFTER INSERT ON LEASE
FOR EACH ROW
BEGIN
    -- Only write if no first lease recorded yet
    UPDATE PROPERTY
    SET first_lease_id = NEW.Lease_ID
    WHERE Property_ID  = NEW.Property_ID
      AND first_lease_id IS NULL;
END$$

DELIMITER ;

-- ────────────────────────────────────────────────────────────
-- VERIFICATION
-- ────────────────────────────────────────────────────────────
SELECT 'Migration complete.' AS Status;

SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'property_mgmt'
  AND TABLE_NAME IN ('PROPERTY','PROPERTY_AGENT')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = 'property_mgmt'
ORDER BY EVENT_OBJECT_TABLE;

SELECT ROUTINE_NAME
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = 'property_mgmt'
  AND ROUTINE_TYPE   = 'PROCEDURE';
