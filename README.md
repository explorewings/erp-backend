# erpnestbackend

NestJS API for the ExploreWings ERP. Uses Drizzle ORM over the shared ExploreWings
Neon Postgres database, and is the auth backend for the `erpfrontend` login.

## Endpoints (base path `/rest/v1`)

| Method | Path            | Description                          |
| ------ | --------------- | ------------------------------------ |
| GET    | `/health`       | Health check                         |
| POST   | `/auth/login`   | Email + password → `{ token, user }` |

## Setup

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL + JWT_SECRET
npm run seed           # creates the users table and the superadmin user
npm run start:dev      # serves on http://localhost:3001/rest/v1
```

## Seeded user

| Username     | Email                        | Password       | Role        |
| ------------ | ---------------------------- | -------------- | ----------- |
| `superadmin` | `infoexplorewings@gmail.com` | `Admin@12345`  | `superadmin` |

Passwords are stored as bcrypt hashes. Re-running `npm run seed` resets the seeded
user's password to the value above.

## Model

`users` (Drizzle: `src/schema/users.ts`) — `id`, `username`, `email`, `password_hash`,
`role`, `created_at`. Both `email` and `username` are unique; emails are normalised to lowercase.
