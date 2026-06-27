# Property Dheko — Property Management System

A full-stack property management platform with role-based portals for tenants, owners, and agents, built with Node.js, Express, and MySQL.

## Features

- **JWT-based authentication** with role-based access control (tenant, owner, agent, admin)
- **Property listings** with amenities, inquiries, and lease management
- **Lease lifecycle management** — creation, status tracking, termination
- **Payment tracking** with categorized payment types (security deposit, monthly rent, late fee, sale payment)
- **Agent commission tracking** across multi-agent property listings
- **Database-enforced data integrity** via triggers — e.g. blocking lease creation on already-sold properties, validating overlapping lease dates, rejecting payments on terminated leases
- **Concurrency-safe transactions** — tested race conditions (e.g. two sessions competing to update the same property) using row-level locking (`SELECT ... FOR UPDATE`) and trigger-based conflict rejection

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** MySQL (`mysql2`)
- **Auth:** JSON Web Tokens (`jsonwebtoken`), password hashing (`bcryptjs`)
- **Frontend:** Vanilla HTML/CSS/JS, separate portals per role

## Project Structure

```
project/
├── server.js              # App entry point
├── middleware/
│   └── auth.js             # JWT verification + role-based access control
├── routes/                 # REST API endpoints (properties, leases, payments, etc.)
├── db/
│   ├── connection.js
│   ├── auth-migration.sql
│   ├── integrity-migration.sql   # Trigger-based data integrity rules
│   ├── multi-agent-migration.sql
│   ├── lease-status-migration.sql
│   ├── sale-migration.sql
│   └── transaction-tests.sql      # Manual concurrency/race-condition test scenarios
├── public/                 # Frontend (tenant, owner, agent, admin portals)
├── schema.sql              # Base database schema
└── seed.sql                # Sample data
```

## Setup

1. Clone the repo and install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your own values:
   ```
   cp .env.example .env
   ```

3. Create the database and load the schema:
   ```
   mysql -u root -p < schema.sql
   mysql -u root -p property_mgmt < seed.sql
   ```

4. Apply migrations (in order):
   ```
   mysql -u root -p property_mgmt < db/auth-migration.sql
   mysql -u root -p property_mgmt < db/integrity-migration.sql
   mysql -u root -p property_mgmt < db/multi-agent-migration.sql
   mysql -u root -p property_mgmt < db/lease-status-migration.sql
   mysql -u root -p property_mgmt < db/sale-migration.sql
   ```

5. Start the server:
   ```
   npm start
   ```

## Concurrency Testing

`db/transaction-tests.sql` contains manual test scenarios for verifying transaction safety under concurrent access — for example, two simultaneous sessions both trying to act on the same property or lease. Run each `SESSION` block in a separate MySQL terminal window, in the order specified in the file's comments, to observe row-level locking and trigger-based conflict resolution in action.

## License

This project was built as a coursework/personal project and is shared for portfolio purposes.
