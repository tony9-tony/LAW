/* Controlled public support assistant. Local knowledge-first responder with
   optional Qwen (OpenAI-compatible chat-completions) enhancement.
   NEVER touches private data, NEVER performs system actions. */
import {
    SUPPORT_IDENTITY, SUPPORT_GREETING, SUPPORT_FALLBACK, SUPPORT_REFUSAL,
    SUPPORT_LINKS, SUPPORT_QUICK_ACTIONS, SUPPORT_FAQ, findFaqById
} from '../data/support-knowledge.js';

const SW_HINT = /[\u00e0-\u00f6\u00f8-\u00ff]|^(habari|mambo|niaje|shikamoo|nawezaje|ninawezaje|ninaweza|nahitaji|nataka|tafadhali|asante|sawa|ndiyo|hapana|nini|wapi|lini|nani|kwa|nina|mimi|wewe|hii|hiyo|hapa|pale|njoo|nenda|omba|ombi|malipo|kulipa|lipa|namba|ankara|risiti|uthibitisho|ushauri|miadi|shauri|ofisi|wasiliana|akaunti|kuingia|nyaraka|kulipwa|ime|yangu|yako|yetu|za|ya|na|ni|je)\b/i;
const EN_HINT = /\b(the|how|what|when|where|payment|request|consultation|book|contact|account|document|matter|invoice|please|thanks|thank|hello|hi|help|can|could|would|should|does|do|is|are|my|your|me|i need|i want)\b/i;
export function detectLang(text = '') {
    const t = String(text || '');
    const sw = (t.match(SW_HINT) || []).length;
    const en = (t.match(EN_HINT) || []).length;
    if (sw > 0 && sw >= en) return 'sw';
    if (en > 0) return 'en';
    return 'en';
}
const REFUSAL_PATTERNS = [
    /verif\w* (my |the )?pay/i, /approv\w* (my |the )?pay/i, /pay (my|this|that|the) invoice/i,
    /create.*matter/i, /accept.*(request|matter)/i, /change.*status/i, /cancel.*appointment/i,
    /show.*(my|my own) (invoice|payment|matter|message|document)/i, /my (invoice|payment|matter|balance|account)/i,
    /delete|update.*(my|account)|reset.*password/i, /run|execute|query|database|sql|server/i,
    /thibitisha malipo/i, /idhinisha malipo/i, /fungua.*shauri/i, /onyesha.*(ankara|malipo|shauri|ujumbe|nyaraka) yangu/i
];
const LEGAL_ADVICE = /(should i sue|can i sue|is it legal|give me legal advice|am i entitled|what are my rights|ushauri wa kish)/i;
function scoreFaq(faq, text) {
    const t = ` ${String(text).toLowerCase()} `;
    let score = 0;
    for (const topic of faq.topics) {
        if (t.includes(topic.toLowerCase())) score += topic.includes(' ') ? 3 : 1;
    }
    return score;
}
export function answerLocally(message, { lang } = {}) {
    const text = String(message || '').slice(0, 2000);
    const useLang = lang === 'sw' || lang === 'en' ? lang : detectLang(text);
    if (REFUSAL_PATTERNS.some((re) => re.test(text))) {
        return { reply: SUPPORT_REFUSAL[useLang], lang: useLang, source: 'policy', faqId: null };
    }
    let best = null;
    let bestScore = 0;
    for (const faq of SUPPORT_FAQ) {
        const s = scoreFaq(faq, text);
        if (s > bestScore) { bestScore = s; best = faq; }
    }
    if (best && bestScore > 0) {
        let reply = best[useLang].a;
        if (LEGAL_ADVICE.test(text)) {
            reply += useLang === 'sw'
                ? ' Kumbuka: siwezi kutoa ushauri wa kisheria — kwa mwongozo kuhusu hali yako, weka miadi ya ushauri.'
                : ' Note: I cannot give legal advice — for guidance on your situation, please book a consultation.';
        }
        return { reply, lang: useLang, source: 'faq', faqId: best.id };
    }
    return { reply: SUPPORT_FALLBACK[useLang], lang: useLang, source: 'fallback', faqId: null };
}
export function greeting(lang = 'en') {
    const useLang = lang === 'sw' ? 'sw' : 'en';
    return { reply: SUPPORT_GREETING[useLang], lang: useLang, source: 'greeting', faqId: null };
}
export function quickActions(lang = 'en') {
    const useLang = lang === 'sw' ? 'sw' : 'en';
    return SUPPORT_QUICK_ACTIONS.map((a) => ({ id: a.id, label: a[useLang] }));
}
export function faqList(lang = 'en') {
    const useLang = lang === 'sw' ? 'sw' : 'en';
    return SUPPORT_FAQ.map((f) => ({ id: f.id, q: f[useLang].q }));
}
export function faqAnswer(id, lang = 'en') {
    const useLang = lang === 'sw' ? 'sw' : 'en';
    const faq = findFaqById(id);
    if (!faq) return { reply: SUPPORT_FALLBACK[useLang], lang: useLang, source: 'fallback', faqId: null };
    return { reply: faq[useLang].a, lang: useLang, source: 'faq', faqId: faq.id };
}
/* Optional Qwen enhancement (Qwen3 via OpenAI-compatible chat completions).
   Only used when QWEN_API_KEY is configured. Qwen NEVER sees private data:
   it receives only the system guardrails + the visitor's single message. */
const QWEN_SYSTEM = `You are the ET CETRA public support assistant (a support assistant, NOT a lawyer).
Rules you must always follow:
- Answer ONLY about: the firm, consultations, requests, payments process, documents process, accounts, tracking status, and contacting the office.
- Be concise (max 4 short sentences), simple language, same language as the visitor message.
- NEVER invent prices, payment methods, office details, times, services, or policies. If unsure, say you do not have that information and direct to Contact Office.
- NEVER claim an action was completed. NEVER give legal advice — recommend booking a consultation.
- If asked to verify/approve payments, create matters, change statuses, or access private data, refuse briefly and direct to sign in or Contact Office.`;
export async function answerWithQwen(message, lang) {
    const apiKey = process.env.QWEN_API_KEY;
    if (!apiKey) return null;
    const baseUrl = (process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
    const model = process.env.QWEN_MODEL || 'qwen3-max';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: QWEN_SYSTEM },
                    { role: 'user', content: String(message || '').slice(0, 2000) }
                ],
                max_tokens: 300,
                temperature: 0.3
            })
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) return null;
        return { reply: text.slice(0, 1500), lang, source: 'qwen', faqId: null };
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
export function supportLinks() {
    return SUPPORT_LINKS;
}
