# Chess Ledger V5 — Dashboard

This version adds a local dashboard on top of the existing SQLite data.

## New dashboard features
- Year filter (All Years / available years)
- Monthly income vs expense chart
- Expense breakdown by category
- Income breakdown by source, including prize money
- Tournament count by format
- Existing tournament, chess expense and chess income features remain
- No rating-change calculation
- Local SQLite database; no cloud/login required

## Run on Linux
```bash
npm install
npm run tauri dev
```

Use the Dashboard tab. The year selector updates the charts without changing stored data.

## Important
This is a development build. Keep your existing Chess Ledger database/project until this version is fully tested. Do not delete previous versions until data and backup/restore are confirmed.
