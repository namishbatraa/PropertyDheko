-- ============================================================
--  Property Management System — Seed Data
--  Safe to re-run: truncates all tables first
-- ============================================================
USE property_mgmt;

-- Disable FK checks so truncate order doesn't matter
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE PAYMENT;
TRUNCATE TABLE TENANT_LEASE;
TRUNCATE TABLE AGENT_INQUIRY;
TRUNCATE TABLE INQUIRY;
TRUNCATE TABLE PROPERTY_AMENITY;
TRUNCATE TABLE LEASE;
TRUNCATE TABLE PROPERTY;
TRUNCATE TABLE AMENITY;
TRUNCATE TABLE TENANT;
TRUNCATE TABLE OWNER;
TRUNCATE TABLE AGENT;
SET FOREIGN_KEY_CHECKS = 1;

-- AGENTS
INSERT INTO AGENT (Name, Phone, Commission_Rate) VALUES
('Ravi Sharma',     '9811001101', 5.00),
('Priya Nair',      '9822002202', 7.50),
('Arjun Mehta',     '9833003303', 6.25),
('Sunita Kapoor',   '9844004404', 4.75),
('Deepak Singh',    '9855005505', 8.00);

-- OWNERS
INSERT INTO OWNER (Name, Phone, Email) VALUES
('Anil Gupta',      '9900110011', 'anil.gupta@mail.com'),
('Meera Joshi',     '9900220022', 'meera.joshi@mail.com'),
('Ramesh Pillai',   '9900330033', 'ramesh.pillai@mail.com'),
('Kavita Reddy',    '9900440044', 'kavita.reddy@mail.com'),
('Suresh Balan',    '9900550055', 'suresh.balan@mail.com');

-- TENANTS
INSERT INTO TENANT (Name, Phone, Email) VALUES
('Amrita Desai',    '9700110011', 'amrita.desai@mail.com'),
('Kiran Raj',       '9700220022', 'kiran.raj@mail.com'),
('Pooja Verma',     '9700330033', 'pooja.verma@mail.com'),
('Sanjay Malhotra', '9700440044', 'sanjay.malhotra@mail.com'),
('Nisha Pandey',    '9700550055', 'nisha.pandey@mail.com'),
('Rohit Mishra',    '9700660066', 'rohit.mishra@mail.com');

-- AMENITIES
INSERT INTO AMENITY (Amenity_Name) VALUES
('Swimming Pool'),
('Gym'),
('Parking'),
('Security'),
('Power Backup'),
('Elevator'),
('Garden'),
('Clubhouse');

-- PROPERTIES
INSERT INTO PROPERTY (Title, Type, Location, Price, Status, AI_Est_Price, Owner_ID, Agent_ID) VALUES
('Sunrise Residency 2BHK',      'Apartment',  'Andheri West, Mumbai',        8500000,  'Available', 8200000,  1, 1),
('Green Valley Villa',          'Villa',      'Whitefield, Bangalore',        22000000, 'Available', 21500000, 2, 2),
('Urban Nest Studio',           'Studio',     'Sector 18, Noida',             3200000,  'Rented',    3100000,  3, 3),
('Skyhigh Penthouse',           'Penthouse',  'Banjara Hills, Hyderabad',     55000000, 'Pending',   54000000, 4, 4),
('Cozy Corner 3BHK',            'Apartment',  'Koregaon Park, Pune',          12000000, 'Available', 11800000, 5, 5),
('Heritage Bungalow',           'Bungalow',   'Civil Lines, Delhi',           38000000, 'Sold',      37500000, 1, 2),
('Marina View Apartment',       'Apartment',  'Besant Nagar, Chennai',        9500000,  'Available', 9400000,  2, 3),
('Lakeshore Cottage',           'Cottage',    'Munnar, Kerala',               6800000,  'Available', 6700000,  3, 1);

-- PROPERTY_AMENITY
INSERT INTO PROPERTY_AMENITY VALUES
(1,2),(1,3),(1,4),(1,5),
(2,1),(2,2),(2,3),(2,4),(2,7),
(3,3),(3,4),
(4,1),(4,2),(4,3),(4,4),(4,5),(4,6),(4,8),
(5,2),(5,3),(5,4),(5,6),
(6,3),(6,4),(6,7),
(7,2),(7,3),(7,4),(7,5),(7,6),
(8,3),(8,7);

-- INQUIRIES
INSERT INTO INQUIRY (Message, Date, Status, Tenant_ID, Property_ID, Agent_ID) VALUES
('Interested in 2BHK. Can we schedule a visit?',       '2026-02-10', 'Responded', 1, 1, 1),
('Is Green Valley Villa pet-friendly?',                '2026-02-12', 'New',       2, 2, 2),
('Wanted to know about the lease terms for Studio.',   '2026-02-15', 'Closed',    3, 3, 3),
('Can you share the floor plan for Penthouse?',        '2026-02-18', 'Responded', 4, 4, 4),
('Looking for 3BHK in Pune under 1.2Cr.',             '2026-02-20', 'New',       5, 5, 5),
('Is Marina View Apartment still available?',          '2026-03-01', 'New',       6, 7, 3),
('Interested in Lakeshore Cottage for vacation stay.', '2026-03-05', 'Responded', 1, 8, 1);

-- AGENT_INQUIRY
INSERT INTO AGENT_INQUIRY VALUES
(1,1),(1,7),(2,2),(3,3),(3,6),(4,4),(5,5);

-- LEASES
INSERT INTO LEASE (Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID) VALUES
('2026-01-01', '2026-12-31', 32000,  64000,  3),
('2026-02-01', '2027-01-31', 85000,  170000, 1),
('2025-06-01', '2026-05-31', 45000,  90000,  5),
('2026-03-01', '2027-02-28', 60000,  120000, 7);

-- TENANT_LEASE
INSERT INTO TENANT_LEASE VALUES
(3,1),(1,2),(5,3),(6,4);

-- PAYMENTS
INSERT INTO PAYMENT (Payment_Date, Amount, Method, Status, Lease_ID) VALUES
('2026-01-05', 32000,  'UPI',           'Success', 1),
('2026-02-05', 32000,  'UPI',           'Success', 1),
('2026-03-05', 32000,  'Bank Transfer', 'Pending', 1),
('2026-02-03', 85000,  'NEFT',          'Success', 2),
('2026-03-03', 85000,  'NEFT',          'Success', 2),
('2025-07-01', 45000,  'Cheque',        'Success', 3),
('2025-08-01', 45000,  'Cheque',        'Failed',  3),
('2025-09-01', 45000,  'Cheque',        'Success', 3),
('2026-03-05', 60000,  'UPI',           'Success', 4);
