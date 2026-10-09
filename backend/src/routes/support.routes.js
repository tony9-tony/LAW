/* Public AI Support endpoints. No authentication required.
   These routes NEVER read private tables and NEVER perform system actions —
   they only return canned knowledge answers (or an optional Qwen
   paraphrase of the same). Strict rate limit + small body limit. */
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
    detectLang, answerLocally, answerWithAi, INTERNAL_QUESTION, greeting,
    quickActions, faqList, faqAnswer, supportLinks
} from '../services/support.service.js';

export const supportRouter = Router();
const supportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === 'test' ? 5000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many support requests, please try again later' } }
});
supportRouter.use(supportLimiter);
const langSchema = z.enum(['en', 'sw']).optional();
supportRouter.get('/greeting', (request, response) => {
    const parsed = z.object({ lang: langSchema }).safeParse(request.query);
    const lang = parsed.success ? (parsed.data.lang ?? 'en') : 'en';
    response.json({ data: { ...greeting(lang), actions: quickActions(lang), links: supportLinks() } });
});
supportRouter.get('/actions', (request, response) => {
    const parsed = z.object({ lang: langSchema }).safeParse(request.query);
    const lang = parsed.success ? (parsed.data.lang ?? 'en') : 'en';
    response.json({ data: { actions: quickActions(lang), links: supportLinks() } });
});
supportRouter.get('/faq', (_request, response) => {
    const parsed = z.object({ lang: langSchema }).safeParse(_request.query);
    const lang = parsed.success ? (parsed.data.lang ?? 'en') : 'en';
    response.json({ data: { faq: faqList(lang), links: supportLinks() } });
});
supportRouter.get('/faq/:id', (request, response) => {
    const parsed = z.object({ lang: langSchema }).safeParse(request.query);
    const lang = parsed.success ? (parsed.data.lang ?? 'en') : 'en';
    response.json({ data: { ...faqAnswer(request.params.id, lang), links: supportLinks() } });
});
const chatSchema = z.object({
    message: z.string().trim().min(1).max(2000),
    lang: langSchema
});
const GREETING = /^\s*(hi+|hey+|hello+|helo|good (morning|afternoon|evening|day)|habari( yako| za asubuhi| za mchana| za jioni)?|mambo|niaje|shikamoo|salama|hujambo|salaam|asalaam?u? alaikum)[\s!?.,]*$/i;
const THANKS = /^\s*(thanks?( you)?( so much| very much)?|thank u|asante( sana)?|ahsante( sana)?|ok(ay)?,? thanks?|sawa,? asante)[\s!?.,]*$/i;
const SW_NO_ANSWER = 'Sina jibu la uhakika la swali hilo. Tafadhali piga simu au tuma WhatsApp kwa kampuni kupitia +255 714 840 951 au +255 657 259 584, au angalia maswali na majibu kwenye ukurasa wa How it works (how-it-works.html).';
const INTERNAL_REFUSAL = {
    en: 'I only have the firm\'s public information, so I cannot help with internal matters, other people, or how the system is built. For your own matter, sign in to the client portal (login.html), or call or WhatsApp the firm on +255 714 840 951 or +255 657 259 584.',
    sw: 'Nina taarifa za umma za kampuni tu, kwa hiyo siwezi kusaidia kuhusu mambo ya ndani, watu wengine, au jinsi mfumo ulivyojengwa. Kwa shauri lako, ingia kwenye portal ya mteja (login.html), au piga simu au tuma WhatsApp kwa +255 714 840 951 au +255 657 259 584.'
};

/* Order: refusals first (never reach the model); a clear FAQ match gets the
   verified answer at once; everything else is answered by the AI from the
   public facts only, falling back to the verified answer if the AI is off,
   busy or slow. */
supportRouter.post('/chat', async (request, response, next) => {
    try {
        const input = chatSchema.parse(request.body);
        const lang = input.lang ?? detectLang(input.message);
        const local = answerLocally(input.message, { lang });
        const send = (data) => response.json({ data: { ...data, links: supportLinks() } });
        if (local.source === 'policy') return send(local);
        if (INTERNAL_QUESTION.test(input.message)) return send({ reply: INTERNAL_REFUSAL[lang === 'sw' ? 'sw' : 'en'], lang, source: 'policy', faqId: null });
        /* A greeting or a thank-you is answered at once, without the model. */
        if (GREETING.test(input.message)) return send(greeting(lang));
        if (THANKS.test(input.message)) return send({ reply: lang === 'sw' ? 'Karibu! Kuna jingine ninaloweza kukusaidia?' : 'You are welcome! Is there anything else I can help with?', lang, source: 'greeting', faqId: null });
        if (local.source === 'faq' && local.score >= 2) return send(local);
        /* The local model's Kiswahili is not good enough to speak for the firm:
           Kiswahili questions get the verified answers until a better model is
           installed and SUPPORT_AI_SWAHILI=1 is set. */
        if (lang === 'sw' && process.env.SUPPORT_AI_SWAHILI !== '1') {
            return send(local.source === 'faq' ? local : { reply: SW_NO_ANSWER, lang: 'sw', source: 'fallback', faqId: null });
        }
        const ai = await answerWithAi(input.message, lang);
        if (ai) return send({ ...ai, faqId: local.faqId });
        return send(local);
    } catch (error) { next(error); }
});
