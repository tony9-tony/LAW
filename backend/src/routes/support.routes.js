/* Public AI Support endpoints. No authentication required.
   These routes NEVER read private tables and NEVER perform system actions —
   they only return canned knowledge answers (or an optional Qwen
   paraphrase of the same). Strict rate limit + small body limit. */
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
    detectLang, answerLocally, answerWithQwen, greeting,
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
supportRouter.post('/chat', async (request, response, next) => {
    try {
        const input = chatSchema.parse(request.body);
        const lang = input.lang ?? detectLang(input.message);
        const local = answerLocally(input.message, { lang });
        /* Policy refusals and unknown questions are deterministic: never
           send them to the external model. */
        if (local.source === 'policy' || local.source === 'fallback') {
            return response.json({ data: { ...local, links: supportLinks() } });
        }
        const enhanced = await answerWithQwen(input.message, lang);
        if (enhanced) return response.json({ data: { ...enhanced, faqId: local.faqId, links: supportLinks() } });
        return response.json({ data: { ...local, links: supportLinks() } });
    } catch (error) { next(error); }
});
