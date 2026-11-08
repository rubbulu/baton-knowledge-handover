# Project Alpha - Handover Notes

## Architecture & Decisions
- Architecture migrated to SQLite for local embedded storage on 2026-10-15 to reduce cloud latency and database hosting cost.
- Authentication was intentionally decoupled from 3rd party OAuth to ensure offline operability.

## Ownership & Responsibilities
- Lead Engineer: Sarah Jenkins (Data pipelines & LLM adapter)
- Operations: Alex Rivera (Deployment, backup jobs, and security audits)

## Current Risks & Known Issues
- The sync worker crashes when receiving batch uploads larger than 50MB due to memory limits in the Node process.
- Database locks during concurrent write spikes if multiple clients trigger ingestion at the exact same second.

## Recurring Problems
- CSV parser fails on unescaped carriage returns from Windows exports. Alex manually sanitizes them before feeding to pipeline.
