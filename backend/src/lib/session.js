/* Signed-in sessions for the browser.
 *
 * At login the server puts the JWT in an httpOnly cookie, so page scripts
 * never hold it (an injected script cannot read or steal it). The browser
 * sends the cookie by itself with every same-site request, image and SSE
 * stream. API clients (a future mobile app, tests) can still send the token
 * as "Authorization: Bearer <token>".
 *
 * The web pages keep the word "session" where they used to keep the token,
 * only to know that someone is signed in; that word is not a credential and
 * is ignored here.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const SESSION_COOKIE = 'law_session';
/* The owner centre (/subui) has its own cookie, so a client signed in in another tab of the
   same browser does not replace the owner's session (and the other way round). The page the
   request comes from decides which one is used (same-origin Referer; helmet is set to send it). */
export const OWNER_SESSION_COOKIE = 'law_owner_session';
export function cookieNameFor(request) {
    const referer = String(request.headers?.referer || request.headers?.referrer || '');
    return /^https?:\/\/[^/]+\/subui(\/|$|\?|#)/i.test(referer) ? OWNER_SESSION_COOKIE : SESSION_COOKIE;
}
const SESSION_MARKER = 'session';
/* One working day: a client is not signed out in the middle of a long session.
   The token (auth.service.js) uses the same lifetime. */
export const SESSION_HOURS = 8;
const MAX_AGE_MS = SESSION_HOURS * 60 * 60 * 1000;

function readCookie(header, name) {
    if (!header) return null;
    for (const part of String(header).split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;
        if (part.slice(0, index).trim() === name) {
            try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
        }
    }
    return null;
}

const usable = (value) => (typeof value === 'string' && value && value !== SESSION_MARKER && value !== 'null' && value !== 'undefined' ? value : null);

/** The token a request carries: Bearer header, then the session cookie, then ?token= (older pages). */
export function requestToken(request) {
    const header = request.headers?.authorization;
    const bearer = header && header.startsWith('Bearer ') ? usable(header.slice(7).trim()) : null;
    return bearer || usable(readCookie(request.headers?.cookie, cookieNameFor(request))) || usable(request.query?.token);
}

/** The verified user of a request, or null. */
export function verifiedUser(request) {
    const token = requestToken(request);
    if (!token) return null;
    try { return jwt.verify(token, config.jwtSecret); } catch { return null; }
}

export function setSessionCookie(response, token, name = SESSION_COOKIE) {
    response.cookie(name, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
        maxAge: MAX_AGE_MS,
        path: '/',
    });
}

export function clearSessionCookie(response, name = SESSION_COOKIE) {
    response.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production', path: '/' });
}
