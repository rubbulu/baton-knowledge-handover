# CodeCraft Club - Core Handover Meeting Notes

## Meeting 1: Leadership Transition & Handover Kickoff
- Date: 2026-03-01
- Attendees: Arjun Mehta (Outgoing Lead), Priya Sharma (Incoming President), Rohan Verma (Events Lead), Sneha Patel (Treasurer)
- Recorded by: Priya Sharma

### Context & Goals
Arjun is graduating in May 2026. This meeting establishes the 60-day transition timeline and transfers architectural ownership of all club assets to Priya and the new core committee.

### Key Architectural Decisions
- Decision: Migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel to handle traffic spikes during HackSprint.
- All code repositories must enforce branch protection on `main` with at least 1 mandatory review from Priya.

### Core Ownership Handover
- Cloud infrastructure (AWS / Supabase): Vikram Aditya
- Finance & Budget Accounts: Sneha Patel
- Hackathon Logistics & Venue Liaison: Rohan Verma

---

## Meeting 2: Infrastructure, Billing & Cloud Services Audit
- Date: 2026-03-08
- Attendees: Arjun Mehta, Priya Sharma, Vikram Aditya
- Recorded by: Arjun Mehta

### Credentials & Cloud Services
- Domain registrar: Namecheap account for `codecraftclub.org`. Renewed until November 2027 by Arjun.
- Database: Supabase free tier currently running for the internal attendance tracker.
- Google Maps API billing account and API key is owned and managed by Priya under her Google Cloud Student account.
- Postmark transactional email token is configured in GitHub Secrets for hackathon notification emails.

### Known Technical Risks & Blockers
- The attendance bot crashes whenever Discord rate limits webhooks with HTTP 429 during general body announcements.
- Single point of failure: Only Arjun holds root console credentials to the AWS alumni server. Need IAM delegation before April 15.

---

## Meeting 3: HackSprint 2026 Logistics & Vendor Review
- Date: 2026-03-14
- Attendees: Priya Sharma, Rohan Verma, Sneha Patel
- Recorded by: Sneha Patel

### Budget & Vendor Agreements
- PrintExpress on MG Road will sponsor 500 event badges and hackathon stickers with a 15% discount using promo code CRAFT15.
- College auditorium booked for October 10-11, 2026 with permission from Dean of Student Affairs.
- Food catering shortlist narrowed to Campus Canteen and Annapurna Caterers; deposit of ₹10,000 due by April 30.

### Open Questions & Recurring Problems
- College WiFi strictly blocks outgoing port 22 (SSH), causing issues during on-campus workshop sessions.
- Students without laptops must be paired with lab machines, which require IT department administrative override.
