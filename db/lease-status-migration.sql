-- Lease status + timestamp migration
USE property_mgmt;

ALTER TABLE LEASE
  ADD COLUMN Lease_Status ENUM('Pending_Payment','Active','Terminated','Expired')
      NOT NULL DEFAULT 'Pending_Payment' AFTER Security_Deposit,
  ADD COLUMN Created_At TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER Lease_Status;

-- Mark existing leases (from seed) as Active since they already have payments
UPDATE LEASE SET Lease_Status = 'Active';
