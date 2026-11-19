import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { env } from '../config/env.js';
import { retrieveDirectory } from '../lib/directoryRetrieval.js';

import { GoogleGenAI } from '@google/genai';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const SYMPTOM_SERVICE_URL = process.env.SYMPTOM_SERVICE_URL || 'http://127.0.0.1:5001';

const SYSTEM_PROMPT = `You are CancerCare AI, a cancer awareness and patient support assistant for people in Zimbabwe.

You provide general educational information about:
- Breast cancer and cervical cancer awareness
- Risk factors, warning signs, and prevention
- Screening guidelines and where to get screened
- Treatment options (overview only)
- How to find doctors and treatment centres in Zimbabwe
- Financial assistance resources

STRICT SAFETY RULES:
1. NEVER diagnose cancer or claim a user has or does not have cancer.
2. NEVER tell a user a symptom is harmless without medical evaluation.
3. NEVER prescribe treatments, medications, or dosages.
4. NEVER fabricate hospitals, doctors, screening events, or equipment availability.
5. ALWAYS recommend consulting a qualified healthcare professional for personal concerns.
6. ALWAYS include a medical disclaimer.
7. For potentially urgent symptoms (severe pain, heavy bleeding, difficulty breathing, etc.), direct users to emergency care immediately.
8. Be honest when you don't have verified information.

Keep responses clear, compassionate, and in plain language. Use short paragraphs and bullet points.`;

// ---------------------------------------------------------------------------
// Safety layer (independent of any model)
// ---------------------------------------------------------------------------

const URGENT_KEYWORDS = [
    'severe bleeding', 'uncontrolled bleeding', 'heavy bleeding', 'hemorrhage',
    'cannot breathe', 'difficulty breathing', 'shortness of breath', 'choking',
    'unconscious', 'passed out', 'fainted', 'seizure', 'convulsion',
    'chest pain', 'heart attack', 'stroke', 'sudden weakness',
    'suicide', 'self-harm', 'overdose', 'poisoning',
    'severe pain', 'emergency',
];

function isUrgent(text) {
    const lc = text.toLowerCase();
    return URGENT_KEYWORDS.some((kw) => lc.includes(kw));
}

// ---------------------------------------------------------------------------
// Topic detection (keyword-based, NOT model-based)
// ---------------------------------------------------------------------------

const BREAST_KEYWORDS = ['breast', 'lump', 'nipple', 'mammogram', 'underarm', 'mastectomy', 'breast pain', 'breast change'];
const CERVICAL_KEYWORDS = ['cervical', 'vaginal', 'bleeding', 'discharge', 'pelvic', 'hpv', 'pap', 'uterus', 'womb', 'menopause'];
const SCREENING_KEYWORDS = ['screening', 'screen', 'test', 'check', 'mammogram', 'pap smear', 'hpv test'];
const DOCTOR_KEYWORDS = ['doctor', 'oncologist', 'specialist', 'physician', 'surgeon', 'gynaecologist'];
const FACILITY_KEYWORDS = ['hospital', 'clinic', 'centre', 'center', 'facility', 'treatment', 'radiotherapy'];
const FOLLOWUP_KEYWORDS = ['cancer', 'risk', 'mean', 'cause', 'probability', 'chance', 'likely', 'diagnosis'];

function detectTopics(text) {
    const lc = text.toLowerCase();
    return {
        breast: BREAST_KEYWORDS.some((kw) => lc.includes(kw)),
        cervical: CERVICAL_KEYWORDS.some((kw) => lc.includes(kw)),
        screening: SCREENING_KEYWORDS.some((kw) => lc.includes(kw)),
        doctor: DOCTOR_KEYWORDS.some((kw) => lc.includes(kw)),
        facility: FACILITY_KEYWORDS.some((kw) => lc.includes(kw)),
        followup: FOLLOWUP_KEYWORDS.some((kw) => lc.includes(kw)),
    };
}

// ---------------------------------------------------------------------------
// Knowledge base responses (clinician-reviewed content)
// ---------------------------------------------------------------------------

const BREAST_HEALTH_RESPONSE = `I understand you're concerned about breast changes. Here's what you should know:

**Breast changes that should be assessed by a healthcare professional:**
- A new lump or thickening in the breast or underarm
- Changes in breast size, shape, or appearance
- Nipple discharge (especially if bloody or clear)
- Nipple inversion or new changes in nipple appearance
- Skin dimpling, puckering, or redness
- Persistent breast pain
- Any new change that concerns you

**Important:** Many breast changes are NOT cancer. Cysts, hormonal changes, infections, and benign conditions can cause similar symptoms. However, only a qualified healthcare professional can determine the cause through proper examination and tests.

**A painless lump does NOT rule out cancer.** Any new lump should be assessed.

**What to do next:**
1. Schedule an appointment with a doctor or breast specialist
2. If you don't have a doctor, use our "Find a Doctor" feature
3. Ask about a clinical breast exam and mammogram if age-appropriate
4. Don't delay — early evaluation is important

**Remember:** I cannot diagnose cancer. Only a qualified healthcare professional can evaluate your symptoms properly.

---
This information is for educational purposes only. Always consult a qualified doctor for personal medical concerns.`;

const CERVICAL_HEALTH_RESPONSE = `I understand you have concerns about cervical or vaginal symptoms. Here's what you should know:

**Symptoms that should be assessed by a healthcare professional:**
- Unusual vaginal bleeding (between periods, after sex, or after menopause)
- Unusual vaginal discharge
- Pelvic pain or pain during intercourse
- Bleeding after menopause

**Important:** These symptoms can have many causes — infections, hormonal changes, polyps, fibroids, and other conditions. They are not always cancer. However, cervical cancer often has no symptoms in early stages, which is why screening is so important.

**Prevention and screening:**
- HPV vaccination (recommended for girls aged 9-14)
- Regular Pap smears (women aged 30-65: every 3 years)
- HPV testing

**What to do next:**
1. Schedule a gynaecology appointment
2. Ask about a Pap smear or HPV test
3. If you have heavy bleeding or severe pain, seek urgent care

**Remember:** I cannot diagnose cancer. Only a qualified healthcare professional can evaluate your symptoms.

---
This information is for educational purposes only. Always consult a qualified doctor.`;

const URGENT_RESPONSE = `This sounds like it could be an emergency. Please seek immediate medical care.

**If you are experiencing:**
- Severe or uncontrolled bleeding
- Severe difficulty breathing
- Sudden loss of consciousness
- Severe chest pain
- Signs of a stroke (sudden weakness, confusion, difficulty speaking)

**Please:**
1. Call emergency services immediately
2. Go to the nearest hospital emergency department
3. Do not wait for online advice

In Zimbabwe, contact your nearest hospital or call the national emergency number.

---
This is emergency guidance, not medical diagnosis.`;

const CANCER_RISK_RESPONSE = `That's a very important question. Here's what you should know:

**Can symptoms alone diagnose cancer?**
No. Symptoms like lumps, bleeding, or pain can have many causes — most of which are NOT cancer. Only a qualified healthcare professional can determine the cause through proper examination and tests (such as biopsies, imaging, or lab tests).

**What about painless lumps?**
A painless lump does NOT rule out cancer, but it also doesn't mean you have cancer. Many benign conditions cause painless lumps. The key is getting it checked.

**The bottom line:**
- Symptoms are a signal to get checked, not a diagnosis
- Early detection through screening saves lives
- Don't panic, but don't ignore changes either
- A doctor can give you a proper evaluation

**What to do next:**
1. Schedule an appointment with a qualified doctor
2. Bring a list of your symptoms and when they started
3. Ask about appropriate tests and screening
4. Follow up on results

**Remember:** I cannot tell you whether you have cancer. Only a qualified healthcare professional can do that.

---
This information is for educational purposes only.`;

const GENERAL_CANCER_RESPONSE = `Here's some general information about cancer:

**What is cancer?**
Cancer is a group of diseases involving abnormal cell growth that can spread to other parts of the body. There are many types, and they behave differently.

**Key facts:**
- Early detection through screening saves lives
- Many cancers are treatable, especially when caught early
- Risk factors include age, family history, lifestyle, and environmental exposures
- Not all lumps or symptoms are cancer

**Prevention:**
- Avoid tobacco
- Limit alcohol
- Eat a balanced diet
- Exercise regularly
- Maintain healthy weight
- Protect skin from UV
- Attend recommended screenings

**Screening in Zimbabwe:**
- Breast: Clinical breast exams, mammograms (age 40+)
- Cervical: Pap smears, HPV testing (age 30+)
- Use our "Find Free Screening" feature to find opportunities near you

**If you're worried about symptoms:**
Please consult a qualified doctor. Use our "Find a Doctor" feature to connect with verified specialists.

---
This information is for educational purposes only. I cannot diagnose cancer or replace a doctor's evaluation.`;

const SCREENING_RESPONSE = `Here's information about cancer screening in Zimbabwe:

**Breast cancer screening:**
- Clinical breast exam by a healthcare professional
- Mammogram (recommended for women 40+)
- Early detection significantly improves outcomes

**Cervical cancer screening:**
- Pap smear (women 30-65: every 3 years)
- HPV testing
- HPV vaccination (girls 9-14, before sexual debut)

**Where to get screened:**
- Use our "Find Free Screening" feature to find upcoming campaigns
- Visit public hospitals and clinics
- Contact verified screening centres

**What to expect:**
- Screening is quick and usually painless
- Results may take a few days to weeks
- Follow-up may be needed if results are abnormal

**Remember:** Screening is for people WITHOUT symptoms. If you have symptoms, see a doctor for diagnostic evaluation.

---
This information is for educational purposes only.`;

const DOCTOR_SEARCH_RESPONSE = `To find a verified doctor in Zimbabwe:

**Our Doctor Directory:**
- Search by specialty (oncology, gynaecology, surgery, etc.)
- Filter by province and city
- View verified registration details
- See hospital affiliations
- Request appointments directly

**How to use:**
1. Go to "Find a Doctor" in the navigation
2. Use the search bar or filters
3. Click on a doctor to see their full profile
4. Request an appointment if available

**Important:** Only doctors marked as "Verified" have had their registration confirmed by CancerCare Zimbabwe administrators.

---
This information is for educational purposes only.`;

const FACILITY_SEARCH_RESPONSE = `To find treatment centres and facilities in Zimbabwe:

**Our Treatment Centres Directory:**
- Public and private hospitals
- Cancer treatment centres
- Screening clinics
- Radiotherapy centres
- Surgical facilities

**How to use:**
1. Go to "Treatment Centres" in the navigation
2. Filter by service, province, or facility type
3. Check radiotherapy equipment availability
4. View contact information and operating hours

**Radiotherapy availability:**
- Status shown is based on manual reports, not live monitoring
- Always confirm availability directly with the facility before travelling

**Important:** Facility information is verified periodically. Always confirm details with the facility.

---
This information is for educational purposes only.`;

const DEFAULT_RESPONSE = `Thank you for your question. I'm here to provide general educational information about cancer awareness, screening, and support in Zimbabwe.

**I can help with:**
- Breast and cervical cancer information
- Risk factors and warning signs
- Screening guidelines
- Finding doctors and treatment centres
- Financial assistance resources
- Appointment booking guidance

**For your specific concern, I recommend:**
1. Consulting a qualified healthcare professional
2. Using our "Find a Doctor" feature
3. Checking our "Find Free Screening" page for screening opportunities

**Important:** I cannot diagnose cancer or replace professional medical advice. If you're experiencing symptoms that worry you, please seek medical evaluation promptly.

---
This information is for educational purposes only.`;

// ---------------------------------------------------------------------------
// Conversation context helpers
// ---------------------------------------------------------------------------

function getLastAssistantTopic(history) {
    // Find the last AI message to understand context
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'assistant') {
            const text = history[i].content.toLowerCase();
            if (text.includes('breast')) return 'breast';
            if (text.includes('cervical') || text.includes('vaginal')) return 'cervical';
            if (text.includes('screening')) return 'screening';
            if (text.includes('doctor')) return 'doctor';
            if (text.includes('facility') || text.includes('hospital')) return 'facility';
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Express route
// ---------------------------------------------------------------------------

export function initAIRoutes(app, db, env) {
    // ---- Health/config status ----
    app.get('/api/ai/status', (_req, res) => {
        const configured = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'your_gemini_api_key_here');
        res.json({
            provider: configured ? 'gemini' : 'local_fallback',
            configured,
            model: configured ? GEMINI_MODEL : null,
            message: configured
                ? 'AI service is configured and ready.'
                : 'AI service is not configured. Set GEMINI_API_KEY in your environment to enable real AI responses. The local fallback provides basic educational information only.',
            symptomService: process.env.SYMPTOM_SERVICE_URL || 'http://127.0.0.1:5001',
        });
    });

    // ---- Unified conversation endpoint ----
    app.post('/api/ai/ask', validate(z.object({
        message: z.string().min(1).max(4000),
        history: z.array(z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string().max(4000),
        })).max(20).optional().default([]),
    })), async (req, res) => {
        const { message, history } = req.body;
        const lc = message.toLowerCase();
        const topics = detectTopics(message);
        // Short follow-ups ("Is it free?", "Can I book?") need the prior user
        // question for location/topic context. Assistant replies are excluded so
        // wording inside them cannot change the detected intent.
        const recentUserContext = history
            .filter((h) => h.role === 'user')
            .slice(-3)
            .map((h) => h.content)
            .join(' ');
        const directory = retrieveDirectory(db, message, recentUserContext);

        // 1. URGENT SAFETY CHECK (independent of any model)
        if (isUrgent(lc)) {
            return res.json({
                reply: URGENT_RESPONSE,
                source: 'safety_layer',
                disclaimer: true,
                urgent: true,
            });
        }

        // Python RNN service is NOT used in the live chat path.
        // The RNN model is unsuitable for medical decisions (classifies
        // "painless breast lump" as "joke"). Its source code is preserved
        // in python-service/ for research and audit purposes only.
        // See: integrations/symptom-checker/ for the original repository.

        // 3. Try Gemini if configured (generative AI)
        const configured = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'your_gemini_api_key_here');
        if (configured) {
            try {
                const contents = [];
                for (const h of history) {
                    contents.push({
                        role: h.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: h.content }],
                    });
                }
                contents.push({ role: 'user', parts: [{ text: message }] });

                const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

                const directoryInstruction = `\n\nVERIFIED ZIMBABWE DIRECTORY DATA (retrieved by the backend for this question):\n${directory.text}\n\nDIRECTORY RULES:\n- Only mention providers, machines, campaigns or organisations that appear in this data.\n- Never invent names, phone numbers, addresses, prices, appointment slots or free events.\n- Distinguish an organisation that exists, a service it advertises, a currently available service, a confirmed free service, and a confirmed appointment. These are not equivalent.\n- If the data says none or is empty, say that no verified record is listed and suggest contacting a local facility.\n- Never state that screening or treatment is free unless the data explicitly confirms it.\n- Never describe radiotherapy equipment as operational unless the data says operational AND includes a direct verification date.\n- Reproduce dates exactly as written in the data. Never change a year (for example, do not turn 2026 into 2025), and say \"date not stated\" when no date is given.\n- If the user asks about booking or one named provider, do not list unrelated providers as booking options.`;

                const geminiPromise = ai.models.generateContent({
                    model: GEMINI_MODEL,
                    contents,
                    config: {
                        systemInstruction: SYSTEM_PROMPT + directoryInstruction,
                        temperature: 0.4,
                        topP: 0.9,
                        maxOutputTokens: 1024,
                    },
                });

                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Gemini request timed out after 30s')), 30000);
                });

                const response = await Promise.race([geminiPromise, timeoutPromise]);

                const reply = response?.text;
                if (reply) {
                    return res.json({
                        reply: reply + '\n\n---\nThis information is for educational purposes only and does not replace professional medical advice. Always consult a qualified doctor.',
                        source: 'gemini',
                        disclaimer: true,
                        model: GEMINI_MODEL,
                        directory_intent: directory.intent,
                        directory_province: directory.province,
                        directory_results: directory.records,
                    });
                }
            } catch (err) {
                console.error('[ai] Gemini error:', err.message);
                let errorType = 'unknown';
                if (err.message?.includes('API_KEY') || err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('INVALID_ARGUMENT')) {
                    errorType = 'invalid_credentials';
                } else if (err.message?.includes('404') || err.message?.includes('not found') || err.message?.includes('NOT_FOUND')) {
                    errorType = 'model_unavailable';
                } else if (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('RESOURCE_EXHAUSTED')) {
                    errorType = 'quota_exhausted';
                } else if (err.message?.includes('503') || err.message?.includes('UNAVAILABLE') || err.message?.includes('high demand')) {
                    errorType = 'service_overloaded';
                } else if (err.message?.includes('timeout') || err.message?.includes('ETIMEDOUT') || err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
                    errorType = 'network_failure';
                }
                console.error('[ai] Gemini error type:', errorType);
                // Fall through to local knowledge base
            }
        }

        // 4. Local knowledge base (keyword-based, NOT model-based)
        const lastTopic = getLastAssistantTopic(history);
        let reply;

        // Follow-up: "Does that mean I have cancer?"
        if (topics.followup && !topics.breast && !topics.cervical && !topics.screening) {
            if (lastTopic === 'breast' || lc.includes('lump') || lc.includes('breast')) {
                reply = CANCER_RISK_RESPONSE;
            } else if (lastTopic === 'cervical' || lc.includes('bleeding') || lc.includes('vaginal')) {
                reply = CANCER_RISK_RESPONSE;
            } else {
                reply = DEFAULT_RESPONSE;
            }
        } else if (topics.breast) {
            reply = BREAST_HEALTH_RESPONSE;
        } else if (topics.cervical) {
            reply = CERVICAL_HEALTH_RESPONSE;
        } else if (topics.screening) {
            reply = SCREENING_RESPONSE;
        } else if (topics.doctor) {
            reply = DOCTOR_SEARCH_RESPONSE;
        } else if (topics.facility) {
            reply = FACILITY_SEARCH_RESPONSE;
        } else if (lc.includes('cancer') || lc.includes('tumor') || lc.includes('oncology')) {
            reply = GENERAL_CANCER_RESPONSE;
        } else {
            reply = DEFAULT_RESPONSE;
        }

        // 5. Attach backend-retrieved verified directory data. Demo records,
        // unverified candidates and expired campaigns never reach this point.
        if (directory.text) {
            reply += `\n\n**Verified directory results (${directory.intent}${directory.province ? `, ${directory.province}` : ''}):**\n${directory.text}\n\nA listing does not confirm current availability, price or an appointment. Please contact the provider directly.`;
        }

        return res.json({
            reply,
            source: 'educational_content',
            disclaimer: true,
            topics,
            directory_intent: directory.intent,
            directory_province: directory.province,
            directory_results: directory.records,
            geminiConfigured: configured,
            geminiError: null,
        });
    });

    // ---- Knowledge retrieval ----
    app.post('/api/ai/retrieve-knowledge', validate(z.object({
        query: z.string().min(2).max(500),
    })), async (req, res) => {
        try {
            const { query } = req.body;
            const lc = query.toLowerCase();

            const knowledgeBase = [
                { keywords: ['breast', 'mammogram', 'screening', 'prevention'], content: 'Breast cancer screening is recommended for women aged 40+ or those at higher risk. Mammograms are the standard screening tool. Early detection significantly improves treatment outcomes.', sources: ['Zimbabwe Ministry of Health and Child Care', 'American Cancer Society'] },
                { keywords: ['cervical', 'pap', 'hpv', 'vaccination'], content: 'Cervical cancer is strongly linked to HPV infection. HPV vaccination is recommended for girls aged 9-14. Regular Pap smears are essential for early detection.', sources: ['WHO Guidelines on Cervical Cancer', 'Zimbabwe National Cervical Cancer Program'] },
                { keywords: ['symptoms', 'pain', 'lump', 'discharge', 'bleeding'], content: 'Common warning signs include: persistent lumps, unusual discharge, changes in breast shape, unexplained weight loss. These symptoms require medical evaluation by a qualified doctor.', sources: ['NHS Cervical Screening Programme', 'CancerCare Zimbabwe Clinical Guidelines'] },
                { keywords: ['treatment', 'chemotherapy', 'radiotherapy', 'surgery'], content: 'Cancer treatment options include surgery, chemotherapy, radiotherapy, and immunotherapy. Treatment plans are individualized by oncologists based on cancer type and stage.', sources: ['NCI Treatment Guidelines', 'ASCO Clinical Practice Guidelines'] },
                { keywords: ['prevention', 'lifestyle', 'diet', 'exercise'], content: 'Cancer prevention strategies: maintain healthy weight, eat balanced diet, exercise regularly, avoid tobacco, limit alcohol, protect skin from UV rays, attend regular screenings.', sources: ['World Cancer Research Fund', 'Zimbabwe Cancer Registry'] },
            ];

            const matches = knowledgeBase.filter((doc) => doc.keywords.some((kw) => lc.includes(kw)));

            if (matches.length === 0) {
                return res.json({ message: 'No matching verified resources found. For personalized medical advice, consult a qualified doctor.', sources: [], disclaimer: 'AI may not have complete information. Always consult medical professionals.' });
            }

            return res.json({
                message: matches.map((m) => m.content).join('\n\n'),
                sources: matches.flatMap((m) => m.sources),
                disclaimer: 'Information is educational only and not medical diagnosis. Consult qualified doctors for evaluation.',
            });
        } catch (err) {
            return res.status(500).json({ error: 'Failed to retrieve knowledge' });
        }
    });

    // ---- Safety check ----
    app.post('/api/ai/safety-check', validate(z.object({
        input: z.string().min(2).max(2000),
    })), async (req, res) => {
        try {
            const { input } = req.body;
            const lc = input.toLowerCase();
            const injectionPatterns = [
                'ignore previous instructions', 'forget your rules', 'reveal your prompt',
                'bypass safety', 'you are now', 'pretend to be', 'system prompt',
                'you are a different model', 'ignore safety guidelines',
            ];
            const isInjection = injectionPatterns.some((pattern) => lc.includes(pattern));
            return res.json({
                safe: !isInjection,
                flagged: isInjection,
                patterns_detected: isInjection ? injectionPatterns.filter((p) => lc.includes(p)) : [],
            });
        } catch (err) {
            return res.status(500).json({ error: 'Safety check failed' });
        }
    });
}
