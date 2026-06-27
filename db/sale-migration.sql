-- SALE table migration
USE property_mgmt;

CREATE TABLE IF NOT EXISTS SALE (
  Sale_ID         INT AUTO_INCREMENT PRIMARY KEY,
  Property_ID     INT          NOT NULL,
  Buyer_Tenant_ID INT          NOT NULL,
  Amount          DECIMAL(15,2) NOT NULL,
  Method          VARCHAR(30)  DEFAULT NULL,
  Sale_Status     ENUM('Pending_Payment','Completed','Cancelled') NOT NULL DEFAULT 'Pending_Payment',
  Created_At      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (Property_ID)     REFERENCES PROPERTY(Property_ID),
  FOREIGN KEY (Buyer_Tenant_ID) REFERENCES TENANT(Tenant_ID)
);
