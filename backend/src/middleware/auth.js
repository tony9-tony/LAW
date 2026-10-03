import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { requestToken } from '../lib/session.js';

export function authenticate(request, response, next) {
    const token = requestToken(request);
    if (!token) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });

    try {
        request.user = jwt.verify(token, config.jwtSecret);
        return next();
    } catch {
        return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Authentication required' } });
    }
}

export function requireRole(...roles) {
    return (request, response, next) => {
        if (!roles.includes(request.user?.role)) {
            return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
        }
        return next();
    };
}
