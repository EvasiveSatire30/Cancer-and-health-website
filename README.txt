CANCERCARE ZIMBABWE - RUNNING WEBSITE
=====================================
This package contains the built website (dist/), the Node/Express backend (src/server/) and the SQLite database (src/cancercare.db). AI chat and the provider directory work once running.

HOW TO RUN
1. Install Node.js 20+ (https://nodejs.org).
2. In this folder run:  npm install --omit=dev
3. Copy .env.example to .env, then set:
   - GEMINI_API_KEY  (needed for AI chat; without it the directory still works)
   - JWT_SECRET and RESET_SECRET (replace the placeholders with strong random values)
4. Start the server:  npm start
5. Open http://localhost:3000 in your browser.

To use a different port:  set PORT=4000  then npm start

NOTES
- The platform is free for patients. No subscriptions or paywalls.
- All provider data is source-confirmed only; nothing is clinically approved.
- Do not share .env or real API keys.
