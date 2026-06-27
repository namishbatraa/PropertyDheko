-- ============================================================
--  PropVault — Transaction Synchronisation Tests
--  Database : property_mgmt
--  Run each SESSION block in a SEPARATE MySQL terminal window.
--
--  Scenarios covered:
--    A) Property status change WHILE a lease is being created
--    B) Payment attempted on an ALREADY-CANCELLED (Terminated) lease
-- ============================================================

USE property_mgmt;

-- ============================================================
--  SETUP — Insert clean test data
--  Run this ONCE before any scenario.
-- ============================================================

-- Clean up previous test data (safe to re-run)
DELETE FROM PAYMENT      WHERE Lease_ID  IN (SELECT Lease_ID FROM LEASE WHERE Property_ID IN (9001, 9002));
DELETE FROM TENANT_LEASE WHERE Lease_ID  IN (SELECT Lease_ID FROM LEASE WHERE Property_ID IN (9001, 9002));
DELETE FROM LEASE        WHERE Property_ID IN (9001, 9002);
DELETE FROM INQUIRY      WHERE Property_ID IN (9001, 9002);
DELETE FROM PROPERTY_AMENITY WHERE Property_ID IN (9001, 9002);
DELETE FROM PROPERTY     WHERE Property_ID IN (9001, 9002);
DELETE FROM AGENT        WHERE Agent_ID   IN (8001);
DELETE FROM OWNER        WHERE Owner_ID   IN (8001);
DELETE FROM TENANT       WHERE Tenant_ID  IN (8001, 8002);

-- Insert supporting data
INSERT INTO AGENT  (Agent_ID, Name, Phone, Commission_Rate) VALUES (8001, 'Test Agent', '9000000001', 5.00);
INSERT INTO OWNER  (Owner_ID, Name, Phone, Email)           VALUES (8001, 'Test Owner', '9000000002', 'test.owner@propvault.com');
INSERT INTO TENANT (Tenant_ID, Name, Phone, Email)          VALUES (8001, 'Tenant Alpha', '9000000003', 'alpha@propvault.com');
INSERT INTO TENANT (Tenant_ID, Name, Phone, Email)          VALUES (8002, 'Tenant Beta',  '9000000004', 'beta@propvault.com');

-- Property for Scenario A: status will race against lease insert
INSERT INTO PROPERTY (Property_ID, Title, Type, Location, Price, Status, Owner_ID, Agent_ID)
VALUES (9001, 'Test Property A', 'Apartment', 'Test City', 50000.00, 'Available', 8001, 8001);

-- Property for Scenario B: will have a lease that gets terminated mid-payment
INSERT INTO PROPERTY (Property_ID, Title, Type, Location, Price, Status, Owner_ID, Agent_ID)
VALUES (9002, 'Test Property B', 'Villa', 'Test City', 80000.00, 'Available', 8001, 8001);

-- Insert an active lease on Property B for Scenario B
INSERT INTO LEASE (Lease_ID, Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID, Lease_Status)
VALUES (7001, '2026-01-01', '2026-12-31', 15000.00, 30000.00, 9002, 'Active');

INSERT INTO TENANT_LEASE (Tenant_ID, Lease_ID) VALUES (8001, 7001);

-- Verify setup
SELECT 'Setup complete. Current state:' AS Message;
SELECT Property_ID, Title, Status FROM PROPERTY WHERE Property_ID IN (9001, 9002);
SELECT Lease_ID, Property_ID, Lease_Status FROM LEASE WHERE Lease_ID = 7001;


-- ============================================================
-- ████████████████████████████████████████████████████████████
--  SCENARIO A: Property Status Change WHILE Lease is Created
-- ████████████████████████████████████████████████████████████
--
--  GOAL : Two sessions race — one marks a property as 'Sold',
--         the other tries to insert a lease on it at the same time.
--         Only ONE should win. The trigger must catch the conflict.
--
--  HOW  : Open TWO separate MySQL terminal windows.
--         Execute steps in the ORDER shown (step A1 → A2 → A3 → A4).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- [SESSION 1 - Terminal A]  Step A1 — Begin transaction, lock property for update
-- ────────────────────────────────────────────────────────────
START TRANSACTION;

-- Lock this property row exclusively (simulates agent marking it Sold)
SELECT Property_ID, Status
FROM PROPERTY
WHERE Property_ID = 9001
FOR UPDATE;

-- *** PAUSE HERE — Switch to Terminal B and run Step A2 ***
-- (Terminal B will try to INSERT a lease while this lock is held)


-- ────────────────────────────────────────────────────────────
-- [SESSION 2 - Terminal B]  Step A2 — Try to create a lease (will BLOCK)
-- ────────────────────────────────────────────────────────────
START TRANSACTION;

-- This INSERT will BLOCK because Session 1 holds a row lock on Property 9001.
-- It will wait until Session 1 commits or rolls back, OR until lock_wait_timeout.
INSERT INTO LEASE (Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID, Lease_Status)
VALUES ('2026-06-01', '2027-05-31', 20000.00, 40000.00, 9001, 'Active');

-- *** PAUSE HERE — Switch back to Terminal A and run Step A3 ***


-- ────────────────────────────────────────────────────────────
-- [SESSION 1 - Terminal A]  Step A3 — Mark property as Sold and COMMIT
-- ────────────────────────────────────────────────────────────
UPDATE PROPERTY
SET Status = 'Sold'
WHERE Property_ID = 9001;

COMMIT;
-- ✅ Session 1 commits: property is now 'Sold'
-- ⏩ Session 2 (Terminal B) unblocks now


-- ────────────────────────────────────────────────────────────
-- [SESSION 2 - Terminal B]  Step A4 — Observe result after unblocking
-- ────────────────────────────────────────────────────────────
-- After Session 1 commits, Terminal B's INSERT unblocks and hits the BEFORE INSERT trigger.
-- The trigger reads Property.Status = 'Sold' → fires SIGNAL → INSERT is REJECTED.
-- Expected error: "Cannot create lease: property is already Sold."

-- If it somehow didn't error, rolling back anyway:
ROLLBACK;

-- ────────────────────────────────────────────────────────────
-- Verify Scenario A result
-- ────────────────────────────────────────────────────────────
SELECT 'Scenario A Result:' AS Message;
SELECT Property_ID, Status AS Property_Status FROM PROPERTY WHERE Property_ID = 9001;
-- Expected: Status = 'Sold'

SELECT COUNT(*) AS Lease_Count_ShouldBe_0
FROM LEASE WHERE Property_ID = 9001;
-- Expected: 0 — no lease was created



-- ============================================================
-- ████████████████████████████████████████████████████████████
--  SCENARIO B: Payment on an Already-Terminated (Cancelled) Lease
-- ████████████████████████████████████████████████████████████
--
--  GOAL : Session 1 terminates a lease. Meanwhile, Session 2 tries
--         to insert a payment against the same lease.
--         The trigger must REJECT the payment even in a race.
--
--  HOW  : Open TWO separate MySQL terminal windows.
--         Execute steps in ORDER: B1 → B2 → B3 → B4
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- [SESSION 1 - Terminal A]  Step B1 — Begin transaction, lock the lease
-- ────────────────────────────────────────────────────────────
START TRANSACTION;

-- Lock the active lease row (simulates admin terminating the lease)
SELECT Lease_ID, Lease_Status
FROM LEASE
WHERE Lease_ID = 7001
FOR UPDATE;

-- *** PAUSE HERE — Switch to Terminal B and run Step B2 ***


-- ────────────────────────────────────────────────────────────
-- [SESSION 2 - Terminal B]  Step B2 — Try to pay against the lease (will BLOCK)
-- ────────────────────────────────────────────────────────────
START TRANSACTION;

-- This INSERT will BLOCK because Session 1 is holding a lock on Lease 7001.
-- Simulates a tenant payment arriving at the same moment admin terminates.
INSERT INTO PAYMENT (Payment_Date, Amount, Payment_Type, Method, Status, Lease_ID)
VALUES (CURDATE(), 15000.00, 'Monthly_Rent', 'Bank Transfer', 'Pending', 7001);

-- *** PAUSE HERE — Switch back to Terminal A and run Step B3 ***


-- ────────────────────────────────────────────────────────────
-- [SESSION 1 - Terminal A]  Step B3 — Terminate the lease and COMMIT
-- ────────────────────────────────────────────────────────────
UPDATE LEASE
SET Lease_Status = 'Terminated'
WHERE Lease_ID = 7001;

COMMIT;
-- ✅ Lease is now Terminated. Property B will be set to Available by trigger.
-- ⏩ Session 2 (Terminal B) unblocks now


-- ────────────────────────────────────────────────────────────
-- [SESSION 2 - Terminal B]  Step B4 — Observe result after unblocking
-- ────────────────────────────────────────────────────────────
-- After Session 1 commits, Terminal B's INSERT unblocks and hits the BEFORE INSERT trigger.
-- Trigger reads Lease_Status = 'Terminated' → fires SIGNAL → INSERT is REJECTED.
-- Expected error: "Payment rejected: lease is no longer active (Terminated or Expired)."

-- If it somehow didn't error, rolling back anyway:
ROLLBACK;

-- ────────────────────────────────────────────────────────────
-- Verify Scenario B result
-- ────────────────────────────────────────────────────────────
SELECT 'Scenario B Result:' AS Message;

SELECT Lease_ID, Lease_Status FROM LEASE WHERE Lease_ID = 7001;
-- Expected: Lease_Status = 'Terminated'

SELECT Property_ID, Status AS Property_Status FROM PROPERTY WHERE Property_ID = 9002;
-- Expected: Status = 'Available' (set by trg_lease_after_update trigger)

SELECT COUNT(*) AS Payment_Count_ShouldBe_0
FROM PAYMENT WHERE Lease_ID = 7001;
-- Expected: 0 — payment was rejected by trigger



-- ============================================================
--  ISOLATION LEVEL CHECK (optional — run in any terminal)
--  See what isolation level your session is using.
-- ============================================================
SELECT @@transaction_isolation AS Current_Isolation_Level;
-- Default MySQL: REPEATABLE-READ
-- This means Session 2 reads a snapshot — but the trigger re-reads live data
-- on BEFORE INSERT, which is why the conflict is correctly caught.

-- To test SERIALIZABLE mode (strictest):
-- SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;


-- ============================================================
--  CLEANUP — Run after all tests to remove test data
-- ============================================================
DELETE FROM PAYMENT      WHERE Lease_ID = 7001;
DELETE FROM TENANT_LEASE WHERE Lease_ID = 7001;
DELETE FROM LEASE        WHERE Property_ID IN (9001, 9002);
DELETE FROM PROPERTY_AMENITY WHERE Property_ID IN (9001, 9002);
DELETE FROM INQUIRY      WHERE Property_ID IN (9001, 9002);
DELETE FROM PROPERTY     WHERE Property_ID IN (9001, 9002);
DELETE FROM TENANT       WHERE Tenant_ID  IN (8001, 8002);
DELETE FROM AGENT        WHERE Agent_ID   = 8001;
DELETE FROM OWNER        WHERE Owner_ID   = 8001;

SELECT 'Cleanup complete.' AS Message;



-- ============================================================
-- ████████████████████████████████████████████████████████████
--  SCENARIO C: Multi-Agent Race — Two Agents Try to Lease/Sell
--              the SAME Property Simultaneously
-- ████████████████████████████████████████████████████████████
--
--  GOAL : Property 9003 is assigned to two agents (8002 & 8003).
--         Both try to create a lease at the exact same time.
--         Only ONE should succeed; the second must be blocked and
--         then rejected (property status will be Pending/Rented).
--
--  HOW  : Open TWO separate MySQL terminal windows.
--         Execute steps in ORDER: C1 → C2 → C3 → C4
-- ============================================================

-- ── Scenario C Setup ──────────────────────────────────────────
DELETE FROM PROPERTY_AGENT   WHERE Property_ID = 9003;
DELETE FROM PROPERTY         WHERE Property_ID = 9003;
DELETE FROM AGENT            WHERE Agent_ID IN (8002, 8003);
DELETE FROM OWNER            WHERE Owner_ID = 8002;
DELETE FROM TENANT           WHERE Tenant_ID IN (8003, 8004);

INSERT INTO AGENT  (Agent_ID, Name, Phone, Commission_Rate) VALUES (8002, 'Agent Alpha', '9100000001', 5.00);
INSERT INTO AGENT  (Agent_ID, Name, Phone, Commission_Rate) VALUES (8003, 'Agent Beta',  '9100000002', 4.00);
INSERT INTO OWNER  (Owner_ID, Name, Phone, Email)           VALUES (8002, 'Multi Owner', '9100000003', 'multi.owner@propvault.com');
INSERT INTO TENANT (Tenant_ID, Name, Phone, Email)          VALUES (8003, 'Tenant C1', '9100000004', 'c1@propvault.com');
INSERT INTO TENANT (Tenant_ID, Name, Phone, Email)          VALUES (8004, 'Tenant C2', '9100000005', 'c2@propvault.com');

INSERT INTO PROPERTY (Property_ID, Title, Type, Location, Price, Status, Owner_ID)
VALUES (9003, 'Test Property C', 'Apartment', 'Race City', 60000.00, 'Available', 8002);

-- Both agents assigned to the same property
INSERT INTO PROPERTY_AGENT (Property_ID, Agent_ID, Is_Primary) VALUES (9003, 8002, 1);
INSERT INTO PROPERTY_AGENT (Property_ID, Agent_ID, Is_Primary) VALUES (9003, 8003, 0);

SELECT 'Scenario C setup complete.' AS Message;
SELECT p.Property_ID, p.Title, p.Status,
       GROUP_CONCAT(pa.Agent_ID ORDER BY pa.Is_Primary DESC SEPARATOR ', ') AS Agent_IDs
FROM PROPERTY p
JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID
WHERE p.Property_ID = 9003
GROUP BY p.Property_ID;


-- ────────────────────────────────────────────────────────────
-- [SESSION 1 - Terminal A]  Step C1 — Agent Alpha begins lease transaction, locks property
-- ────────────────────────────────────────────────────────────
START TRANSACTION;

-- Acquire exclusive lock on the property row (simulates agentPortal POST /leases)
SELECT p.Property_ID, p.Status
FROM PROPERTY p
JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID
WHERE p.Property_ID = 9003 AND pa.Agent_ID = 8002
FOR UPDATE;

-- *** PAUSE HERE — Switch to Terminal B and run Step C2 ***


-- ────────────────────────────────────────────────────────────
-- [SESSION 2 - Terminal B]  Step C2 — Agent Beta tries to lease (will BLOCK)
-- ────────────────────────────────────────────────────────────
START TRANSACTION;

-- Agent Beta's FOR UPDATE will BLOCK because Agent Alpha holds the row lock.
-- This is the exact race condition the locking prevents.
SELECT p.Property_ID, p.Status
FROM PROPERTY p
JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID
WHERE p.Property_ID = 9003 AND pa.Agent_ID = 8003
FOR UPDATE;

-- *** PAUSE HERE — Switch back to Terminal A and run Step C3 ***


-- ────────────────────────────────────────────────────────────
-- [SESSION 1 - Terminal A]  Step C3 — Agent Alpha creates lease and COMMITs
-- ────────────────────────────────────────────────────────────
INSERT INTO LEASE (Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID, Lease_Status)
VALUES ('2026-07-01', '2027-06-30', 20000.00, 40000.00, 9003, 'Active');

UPDATE PROPERTY SET Status = 'Rented' WHERE Property_ID = 9003;

COMMIT;
-- ✅ Agent Alpha wins. Property is now 'Rented'.
-- ⏩ Agent Beta (Terminal B) unblocks now.


-- ────────────────────────────────────────────────────────────
-- [SESSION 2 - Terminal B]  Step C4 — Agent Beta observes conflict & ROLLBACKs
-- ────────────────────────────────────────────────────────────
-- After Agent Alpha commits, Terminal B unblocks and reads Status = 'Rented'.
-- In the application layer (agentPortal.js), this is caught and rejected with HTTP 409.
-- At the raw SQL level, simulate the application check:
SELECT Status INTO @prop_status FROM PROPERTY WHERE Property_ID = 9003;
SELECT @prop_status AS Property_Status_After_Unblock;
-- Expected: 'Rented' — Agent Beta's lease attempt must now be rejected.

ROLLBACK; -- Agent Beta cannot proceed; lease rejected.


-- ────────────────────────────────────────────────────────────
-- Verify Scenario C result
-- ────────────────────────────────────────────────────────────
SELECT 'Scenario C Result:' AS Message;
SELECT Property_ID, Status FROM PROPERTY WHERE Property_ID = 9003;
-- Expected: Status = 'Rented'

SELECT COUNT(*) AS Lease_Count_ShouldBe_1 FROM LEASE WHERE Property_ID = 9003;
-- Expected: 1 — only Agent Alpha's lease exists

SELECT Lease_ID, Property_ID, Lease_Status FROM LEASE WHERE Property_ID = 9003;


-- ── Scenario C Cleanup ────────────────────────────────────────
DELETE FROM TENANT_LEASE WHERE Lease_ID IN (SELECT Lease_ID FROM LEASE WHERE Property_ID = 9003);
DELETE FROM LEASE        WHERE Property_ID = 9003;
DELETE FROM PROPERTY_AGENT WHERE Property_ID = 9003;
DELETE FROM PROPERTY     WHERE Property_ID = 9003;
DELETE FROM TENANT       WHERE Tenant_ID IN (8003, 8004);
DELETE FROM AGENT        WHERE Agent_ID IN (8002, 8003);
DELETE FROM OWNER        WHERE Owner_ID = 8002;

SELECT 'Scenario C cleanup complete.' AS Message;

