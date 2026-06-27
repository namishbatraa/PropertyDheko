-- ============================================================
--  PropVault — Schema Integrity Migration
--  Run once. Safe to re-run (uses IF EXISTS checks).
-- ============================================================
USE property_mgmt;

-- ────────────────────────────────────────────────────────────
-- FIX 1: AGENT_INQUIRY is redundant — INQUIRY.Agent_ID already
--         stores the relationship. Drop it to avoid inconsistency.
-- ────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS AGENT_INQUIRY;


-- ────────────────────────────────────────────────────────────
-- FIX 2: AMENITY.Amenity_Name must be UNIQUE (no duplicate "Gym" etc.)
-- ────────────────────────────────────────────────────────────
-- Remove any existing duplicates first (keep lowest ID)
DELETE a FROM AMENITY a
  INNER JOIN (
    SELECT MIN(Amenity_ID) AS keep_id, Amenity_Name
    FROM AMENITY
    GROUP BY Amenity_Name
    HAVING COUNT(*) > 1
  ) dupes ON a.Amenity_Name = dupes.Amenity_Name AND a.Amenity_ID != dupes.keep_id;

-- Add unique constraint
ALTER TABLE AMENITY
  ADD CONSTRAINT uq_amenity_name UNIQUE (Amenity_Name);


-- ────────────────────────────────────────────────────────────
-- FIX 3: PAYMENT — add Payment_Type to distinguish purpose
-- ────────────────────────────────────────────────────────────
ALTER TABLE PAYMENT
  ADD COLUMN Payment_Type ENUM('Security_Deposit','Monthly_Rent','Late_Fee','Sale_Payment','Other')
      NOT NULL DEFAULT 'Monthly_Rent' AFTER Amount;

-- Back-fill existing rows: if Amount matches Security_Deposit of the lease, tag as Security_Deposit
UPDATE PAYMENT p
  JOIN LEASE l ON p.Lease_ID = l.Lease_ID
  SET p.Payment_Type = 'Security_Deposit'
  WHERE p.Amount = l.Security_Deposit
    AND p.Payment_Type = 'Monthly_Rent';   -- only update untagged rows


-- ────────────────────────────────────────────────────────────
-- FIX 4: PROPERTY.Status — enforce as ENUM for tighter control
--  (already has CHECK constraint, but ENUM is enforced by engine)
-- ────────────────────────────────────────────────────────────
-- (CHECK constraint already in schema.sql; no DDL change needed here)


-- ────────────────────────────────────────────────────────────
-- DROP existing triggers if any (clean slate)
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_lease_before_insert;
DROP TRIGGER IF EXISTS trg_lease_after_insert;
DROP TRIGGER IF EXISTS trg_lease_after_delete;
DROP TRIGGER IF EXISTS trg_lease_after_update;
DROP TRIGGER IF EXISTS trg_payment_before_insert;
DROP TRIGGER IF EXISTS trg_inquiry_before_insert;


-- ============================================================
-- TRIGGER 1: BEFORE INSERT ON LEASE
--   • Block insertion if property is Sold
--   • Block insertion if an active (non-Terminated/Expired) lease
--     already exists for this property with overlapping dates
-- ============================================================
DELIMITER $$

CREATE TRIGGER trg_lease_before_insert
BEFORE INSERT ON LEASE
FOR EACH ROW
BEGIN
  DECLARE v_status      VARCHAR(20);
  DECLARE v_overlap_cnt INT DEFAULT 0;

  -- Check property status
  SELECT Status INTO v_status
  FROM PROPERTY
  WHERE Property_ID = NEW.Property_ID;

  IF v_status = 'Sold' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot create lease: property is already Sold.';
  END IF;

  -- Check date range validity
  IF NEW.End_Date <= NEW.Start_Date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Lease End_Date must be after Start_Date.';
  END IF;

  -- Check for overlapping active leases on same property
  SELECT COUNT(*) INTO v_overlap_cnt
  FROM LEASE
  WHERE Property_ID = NEW.Property_ID
    AND Lease_Status NOT IN ('Terminated', 'Expired')
    AND Start_Date < NEW.End_Date
    AND End_Date   > NEW.Start_Date;

  IF v_overlap_cnt > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot create lease: an active lease already exists for this property in the given date range.';
  END IF;
END$$


-- ============================================================
-- TRIGGER 2: AFTER INSERT ON LEASE
--   • Set PROPERTY.Status = 'Rented' when a new lease is created
--     (only if Lease_Status is Active — Pending_Payment leaves it as Pending)
-- ============================================================
CREATE TRIGGER trg_lease_after_insert
AFTER INSERT ON LEASE
FOR EACH ROW
BEGIN
  IF NEW.Lease_Status = 'Active' THEN
    UPDATE PROPERTY SET Status = 'Rented' WHERE Property_ID = NEW.Property_ID;
  ELSEIF NEW.Lease_Status = 'Pending_Payment' THEN
    UPDATE PROPERTY SET Status = 'Pending' WHERE Property_ID = NEW.Property_ID;
  END IF;
END$$


-- ============================================================
-- TRIGGER 3: AFTER DELETE ON LEASE
--   • When a lease is removed, set property back to Available
--     UNLESS another active lease still exists for that property
--     OR the property is already Sold
-- ============================================================
CREATE TRIGGER trg_lease_after_delete
AFTER DELETE ON LEASE
FOR EACH ROW
BEGIN
  DECLARE v_active_cnt INT DEFAULT 0;
  DECLARE v_status     VARCHAR(20);

  SELECT Status INTO v_status FROM PROPERTY WHERE Property_ID = OLD.Property_ID;

  -- Don't touch Sold properties
  IF v_status != 'Sold' THEN
    SELECT COUNT(*) INTO v_active_cnt
    FROM LEASE
    WHERE Property_ID = OLD.Property_ID
      AND Lease_Status NOT IN ('Terminated', 'Expired');

    IF v_active_cnt = 0 THEN
      UPDATE PROPERTY SET Status = 'Available' WHERE Property_ID = OLD.Property_ID;
    END IF;
  END IF;
END$$


-- ============================================================
-- TRIGGER 4: AFTER UPDATE ON LEASE (status changed to Terminated/Expired)
--   • When lease status changes to Terminated or Expired, check
--     if property should go back to Available
-- ============================================================
CREATE TRIGGER trg_lease_after_update
AFTER UPDATE ON LEASE
FOR EACH ROW
BEGIN
  DECLARE v_active_cnt INT DEFAULT 0;
  DECLARE v_status     VARCHAR(20);

  -- Only act when Lease_Status changes to a terminal state
  IF NEW.Lease_Status IN ('Terminated', 'Expired')
     AND OLD.Lease_Status = 'Active' THEN

    SELECT Status INTO v_status FROM PROPERTY WHERE Property_ID = NEW.Property_ID;

    IF v_status != 'Sold' THEN
      SELECT COUNT(*) INTO v_active_cnt
      FROM LEASE
      WHERE Property_ID = NEW.Property_ID
        AND Lease_ID   != NEW.Lease_ID
        AND Lease_Status NOT IN ('Terminated', 'Expired');

      IF v_active_cnt = 0 THEN
        UPDATE PROPERTY SET Status = 'Available' WHERE Property_ID = NEW.Property_ID;
      END IF;
    END IF;
  END IF;

  -- If lease becomes Active (security deposit paid), set property Rented
  IF NEW.Lease_Status = 'Active' AND OLD.Lease_Status = 'Pending_Payment' THEN
    UPDATE PROPERTY SET Status = 'Rented' WHERE Property_ID = NEW.Property_ID;
  END IF;
END$$


-- ============================================================
-- TRIGGER 5: BEFORE INSERT ON PAYMENT
--   • Validate the referenced lease exists and is not Terminated/Expired
--   • Validate amount is positive (belt-and-suspenders with CHECK)
-- ============================================================
CREATE TRIGGER trg_payment_before_insert
BEFORE INSERT ON PAYMENT
FOR EACH ROW
BEGIN
  DECLARE v_lease_status VARCHAR(30);

  SELECT Lease_Status INTO v_lease_status
  FROM LEASE
  WHERE Lease_ID = NEW.Lease_ID;

  IF v_lease_status IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Payment rejected: referenced lease does not exist.';
  END IF;

  IF v_lease_status IN ('Terminated', 'Expired') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Payment rejected: lease is no longer active (Terminated or Expired).';
  END IF;

  IF NEW.Amount <= 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Payment rejected: amount must be greater than zero.';
  END IF;
END$$


-- ============================================================
-- TRIGGER 6: BEFORE INSERT ON INQUIRY
--   • Ensure the Agent_ID in the inquiry matches the property's
--     assigned agent — prevents agent mismatch / data inconsistency
-- ============================================================
CREATE TRIGGER trg_inquiry_before_insert
BEFORE INSERT ON INQUIRY
FOR EACH ROW
BEGIN
  DECLARE v_property_agent INT;

  SELECT Agent_ID INTO v_property_agent
  FROM PROPERTY
  WHERE Property_ID = NEW.Property_ID;

  IF v_property_agent IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Inquiry rejected: property not found.';
  END IF;

  IF NEW.Agent_ID != v_property_agent THEN
    -- Auto-correct: set Agent_ID to the property's actual agent
    SET NEW.Agent_ID = v_property_agent;
  END IF;
END$$

DELIMITER ;

-- ────────────────────────────────────────────────────────────
-- VERIFICATION: list all triggers created
-- ────────────────────────────────────────────────────────────
SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = 'property_mgmt'
ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING;
