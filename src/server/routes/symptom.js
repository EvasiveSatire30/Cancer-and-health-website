import { z } from 'zod';
import { validate } from '../middleware/validation.js';

// Internal Python symptom recognition service URL
const SYMPTOM_SERVICE_URL = process.env.SYMPTOM_SERVICE_URL || 'http://127.0.0.1:5001';

// Educational response templates (clinician-reviewed content)
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

**What to do next:**
1. Schedule an appointment with a doctor or breast specialist
2. If you don't have a doctor, use our "Find a Doctor" feature
3. Ask about a clinical breast exam and mammogram if age-appropriate
4. Don't delay — early evaluation is important

**A painless lump does NOT rule out cancer.** Any new lump should be assessed.

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

const GENERAL_RESPONSE = `Thank you for your question. I'm here to provide general educational information about cancer awareness, screening, and support in Zimbabwe.

**I can help with:**
- Breast and cervical cancer information
- Risk factors and warning signs
- Screening guidelines
- Finding doctors and treatment centres
- Financial assistance resources

**For your specific concern, I recommend:**
1. Consulting a qualified healthcare professional
2. Using our "Find a Doctor" feature
3. Checking our "Find Free Screening" page

**Important:** I cannot diagnose cancer or replace professional medical advice. If you're experiencing symptoms that worry you, please seek medical evaluation promptly.

---
This information is for educational purposes only.`;

// Safety keywords (checked before any model call)
const URGENT_KEYWORDS = [
    'severe bleeding', 'uncontrolled bleeding', 'heavy bleeding', 'hemorrhage',
    'cannot breathe', 'difficulty breathing', 'shortness of breath', 'choking',
    'unconscious', 'passed out', 'fainted', 'seizure', 'convulsion',
    'chest pain', 'heart attack', 'stroke', 'sudden weakness',
    'suicide', 'self-harm', 'overdose', 'poisoning',
    'severe pain', 'emergency',
];

const BREAST_KEYWORDS = ['breast', 'lump', 'nipple', 'mammogram', 'underarm', 'chest', 'mastectomy'];
const CERVICAL_KEYWORDS = ['cervical', 'vaginal', 'bleeding', 'discharge', 'pelvic', 'hpv', 'pap', 'uterus', 'womb'];

function isUrgent(text) {
    const lc = text.toLowerCase();
    return URGENT_KEYWORDS.some((kw) => lc.includes(kw));
}

function isBreastRelated(text) {
    const lc = text.toLowerCase();
    return BREAST_KEYWORDS.some((kw) => lc.includes(kw));
}

function isCervicalRelated(text) {
    const lc = text.toLowerCase();
    return CERVICAL_KEYWORDS.some((kw) => lc.includes(kw));
}

export function initSymptomRoutes(app, db, env) {
    // ---- Check Python service health ----
    app.get('/api/symptom/status', async (_req, res) => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${SYMPTOM_SERVICE_URL}/health`, { signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) throw new Error(`Service returned ${response.status}`);
            const data = await response.json();
            res.json({
                available: true,
                modelLoaded: data.model_loaded,
                tagsCount: data.tags_count,
                note: 'Experimental RNN classifier. NOT medically validated. Used for topic recognition only.',
            });
        } catch (err) {
            res.json({
                available: false,
                modelLoaded: false,
                note: `Symptom recognition service is unavailable: ${err.message}. Educational responses will use keyword-based detection.`,
            });
        }
    });

    // ---- Symptom check endpoint ----
    app.post('/api/symptom/check', validate(z.object({
        message: z.string().min(1).max(2000),
    })), async (req, res) => {
        const { message } = req.body;
        const lc = message.toLowerCase();

        // 1. Safety check FIRST (independent of model)
        if (isUrgent(lc)) {
            return res.json({
                response: URGENT_RESPONSE,
                category: 'urgent',
                source: 'safety_layer',
                disclaimer: true,
                urgent: true,
            });
        }

        // 2. Try Python service (experimental classifier)
        let pythonResult = null;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${SYMPTOM_SERVICE_URL}/classify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (response.ok) {
                pythonResult = await response.json();
            }
        } catch (err) {
            console.error('Symptom service unavailable:', err.message);
            // Continue with keyword-based fallback
        }

        // 3. Determine response based on cancer-related keywords (NOT model output)
        // The model's classification is logged but NEVER shown to users
        if (pythonResult) {
            console.log(`[symptom] model classified as "${pythonResult.classification}" (conf: ${pythonResult.confidence}) - NOT shown to user`);
        }

        if (isBreastRelated(lc)) {
            return res.json({
                response: BREAST_HEALTH_RESPONSE,
                category: 'breast_health',
                source: 'approved_knowledge_base',
                disclaimer: true,
                modelClassification: pythonResult?.classification || null, // internal only
                modelConfidence: pythonResult?.confidence || null, // internal only
            });
        }

        if (isCervicalRelated(lc)) {
            return res.json({
                response: CERVICAL_HEALTH_RESPONSE,
                category: 'cervical_health',
                source: 'approved_knowledge_base',
                disclaimer: true,
                modelClassification: pythonResult?.classification || null,
                modelConfidence: pythonResult?.confidence || null,
            });
        }

        // 4. General fallback
        return res.json({
            response: GENERAL_RESPONSE,
            category: 'general',
            source: 'approved_knowledge_base',
            disclaimer: true,
            modelClassification: pythonResult?.classification || null,
            modelConfidence: pythonResult?.confidence || null,
        });
    });
}
