import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

export async function registerUser({ email, password, fullName, role = 'CLIENT' }) {
    if (!['CLIENT', 'LAWYER', 'STAFF', 'OWNER'].includes(role)) {
        const error = new Error('Invalid role');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, full_name, role, created_at`,
        [email.toLowerCase(), passwordHash, fullName, role],
    );
    const row = result.rows[0];
    return { id: row.id, email: row.email, fullName: row.full_name, role: row.role, createdAt: row.created_at };
}

export async function loginUser({ email, password }) {
    const result = await query('SELECT id, email, password_hash, full_name, role FROM users WHERE email = $1 AND is_active = TRUE', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        const error = new Error('Invalid credentials');
        error.statusCode = 401;
        error.code = 'INVALID_CREDENTIALS';
        throw error;
    }
    const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, config.jwtSecret, { expiresIn: '1h' });
    return { token, user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } };
}
