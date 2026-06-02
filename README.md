# La Rencontre

A private AI chief of staff and mentor for Jensen, founder of La Rencontre Hospitality (Dubai).
PA first: mentor chat, morning brief, entity first portfolio (venues, clients, events), Eisenhower task quadrants, UAE aware finance, a document brain (RAG), branded document generation, and a calendar. See PRD.md.

## Stack
Next.js 14 (App Router) · Claude (mentor + generation) · OpenAI embeddings (document brain) · headless Chrome (branded PDFs) · localStorage (v1 persistence) · deployed on Vercel at jensen.zanii.agency.

## Run
```
npm install
npm run dev
```
Env: ANTHROPIC_API_KEY, OPENAI_API_KEY, APP_PASSWORD, SESSION_SECRET. See .env.example.
