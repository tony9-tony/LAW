-- Migration 005: Owner role and permissions system.
-- Requires the OWNER enum value added by 004_owner_enum.sql.

-- Permissions table for granular access control
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Role-permissions mapping
CREATE TABLE IF NOT EXISTS role_permissions (
    role user_role NOT NULL,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role, permission_id)
);

-- User-specific permission overrides (rare, for exceptions)
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission_id)
);

-- System settings table (key-value with JSONB)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'general',
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security events log (extends audit_logs for security-specific tracking)
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    severity TEXT NOT NULL DEFAULT 'info',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS security_events_actor_idx ON security_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_target_idx ON security_events (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_idx ON security_events (event_type, created_at DESC);

-- Seed permissions
INSERT INTO permissions (code, description, category) VALUES
-- Users
('users.view', 'View user list and details', 'users'),
('users.manage', 'Create, edit, deactivate users', 'users'),
('users.roles', 'Assign/change user roles', 'users'),
-- Clients
('clients.view', 'View client list and details', 'clients'),
('clients.manage', 'Edit client information', 'clients'),
-- Lawyers
('lawyers.view', 'View lawyer list and details', 'lawyers'),
('lawyers.manage', 'Create, edit, deactivate lawyers', 'lawyers'),
-- Staff
('staff.view', 'View staff list and details', 'staff'),
('staff.manage', 'Create, edit, deactivate staff', 'staff'),
-- Requests
('requests.view', 'View all service requests', 'requests'),
('requests.manage', 'Assign, change status, workflow actions', 'requests'),
-- Matters
('matters.view', 'View all matters/cases', 'matters'),
('matters.manage', 'Edit matter details, assignments', 'matters'),
-- Appointments
('appointments.view', 'View all appointments', 'appointments'),
('appointments.manage', 'Create, edit, cancel appointments', 'appointments'),
-- Documents
('documents.view', 'View document metadata', 'documents'),
('documents.manage', 'Upload, delete, manage documents', 'documents'),
-- Notifications
('notifications.view', 'View notification statistics', 'notifications'),
('notifications.manage', 'Send system notifications, manage templates', 'notifications'),
-- Reports
('reports.view', 'View analytics and reports', 'reports'),
('reports.export', 'Export reports', 'reports'),
-- Audit
('audit.view', 'View audit logs', 'audit'),
('audit.export', 'Export audit logs', 'audit'),
-- Security
('security.view', 'View security events and activity', 'security'),
-- Settings
('settings.view', 'View system settings', 'settings'),
('settings.manage', 'Modify system settings', 'settings'),
-- Roles & Permissions
('roles.view', 'View roles and permissions', 'roles'),
('roles.manage', 'Manage role-permission mappings', 'roles')
ON CONFLICT (code) DO NOTHING;

-- Grant all permissions to OWNER role
INSERT INTO role_permissions (role, permission_id)
SELECT 'OWNER', id FROM permissions
ON CONFLICT DO NOTHING;

-- Grant appropriate permissions to LAWYER
INSERT INTO role_permissions (role, permission_id)
SELECT 'LAWYER', id FROM permissions WHERE code IN (
    'clients.view', 'requests.view', 'requests.manage', 'matters.view', 'matters.manage',
    'appointments.view', 'appointments.manage', 'documents.view', 'documents.manage',
    'messages.view', 'notifications.view', 'reports.view'
)
ON CONFLICT DO NOTHING;

-- Grant appropriate permissions to STAFF
INSERT INTO role_permissions (role, permission_id)
SELECT 'STAFF', id FROM permissions WHERE code IN (
    'clients.view', 'requests.view', 'requests.manage', 'matters.view', 'matters.manage',
    'appointments.view', 'appointments.manage', 'documents.view', 'documents.manage',
    'messages.view', 'notifications.view', 'reports.view'
)
ON CONFLICT DO NOTHING;

-- Grant minimal permissions to CLIENT (for self-service)
INSERT INTO role_permissions (role, permission_id)
SELECT 'CLIENT', id FROM permissions WHERE code IN (
    'requests.view', 'matters.view', 'appointments.view', 'documents.view', 'messages.view', 'notifications.view'
)
ON CONFLICT DO NOTHING;

-- Default system settings
INSERT INTO system_settings (key, value, description, category) VALUES
('company_name', '"[Law Firm Name]"', 'Company display name', 'general'),
('company_tagline', '"Advocates & Legal Counsel"', 'Company tagline', 'general'),
('timezone', '"Africa/Dar_es_Salaam"', 'System timezone', 'general'),
('currency', '"TZS"', 'Default currency', 'general'),
('session_timeout_minutes', '60', 'JWT token expiry in minutes', 'security'),
('password_min_length', '12', 'Minimum password length', 'security'),
('maintenance_mode', 'false', 'Enable maintenance mode', 'system')
ON CONFLICT (key) DO NOTHING;