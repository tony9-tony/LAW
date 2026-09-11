/* Frontend settings system
   Integrates with the existing backend user_settings and system_settings APIs */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;

    let currentUserSettings = null;
    let systemSettings = null;
    let isPollingPaused = false;
    let pollTimer = null;

    const settingsContainer = document.getElementById('settings-container');
    const appearanceTab = document.getElementById('appearance-tab');
    const notificationTab = document.getElementById('notification-tab');
    const systemTab = document.getElementById('system-tab');

    const appearanceContent = document.getElementById('appearance-content');
    const notificationContent = document.getElementById('notification-content');
    const systemContent = document.getElementById('system-content');

    const settingsLoading = document.getElementById('settings-loading');

    // Initialize settings system
    async function initSettings() {
        // Load user settings
        await loadUserSettings();
        await loadSystemSettings();
        
        // Apply initial theme
        applyTheme(currentUserSettings?.theme || 'system');
        
        // Set up periodic updates
        startPolling();
        
        // Setup message handler integration for realtime updates
        if (window.messageService) {
            window.messageService.on('settings.updated', (userId, settings) => {
                if (userId === window.messageService.getCurrentUserId()) {
                    handleSettingsUpdate(settings);
                }
            });
        }
    }

    // Load user settings from API
    async function loadUserSettings() {
        try {
            const response = await API.request('/profile/settings');
            currentUserSettings = response.data;
            
            // Render user settings UI
            renderUserSettings();
        } catch (error) {
            console.error('Failed to load user settings:', error);
            showError('Failed to load settings. Please try again.');
        }
    }

    // Load system settings from API
    async function loadSystemSettings() {
        try {
            const response = await API.request('/owner/settings');
            systemSettings = response.data;
            
            // Render system settings UI
            renderSystemSettings();
        } catch (error) {
            console.error('Failed to load system settings:', error);
            // Don't show error for system settings as they're less critical
        }
    }

    // Render user settings UI
    function renderUserSettings() {
        if (!appearanceContent) return;
        
        appearanceContent.innerHTML = `
            <div class="settings-section">
                <h3>Appearance Settings</h3>
                
                <div class="form-group">
                    <label class="form-label">Theme</label>
                    <div class="theme-selector">
                        <button 
                            class="theme-option ${currentUserSettings?.theme === 'light' ? 'active' : ''}" 
                            onclick="setUserSetting('theme', 'light')"
                            data-theme="light"
                        >
                            <span class="theme-preview light"></span>
                            <span class="theme-label">Light</span>
                        </button>
                        <button 
                            class="theme-option ${currentUserSettings?.theme === 'dark' ? 'active' : ''}" 
                            onclick="setUserSetting('theme', 'dark')"
                            data-theme="dark"
                        >
                            <span class="theme-preview dark"></span>
                            <span class="theme-label">Dark</span>
                        </button>
                        <button 
                            class="theme-option ${currentUserSettings?.theme === 'system' ? 'active' : ''}" 
                            onclick="setUserSetting('theme', 'system')"
                            data-theme="system"
                        >
                            <span class="theme-preview system"></span>
                            <span class="theme-label">System</span>
                        </button>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Font Size</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input 
                                type="radio" 
                                name="font_size" 
                                value="small" 
                                ${currentUserSettings?.font_size === 'small' ? 'checked' : ''}
                                onclick="setUserSetting('font_size', 'small')"
                            >
                            <span>Small</span>
                        </label>
                        <label class="radio-option">
                            <input 
                                type="radio" 
                                name="font_size" 
                                value="medium" 
                                ${currentUserSettings?.font_size === 'medium' ? 'checked' : ''}
                                onclick="setUserSetting('font_size', 'medium')"
                            >
                            <span>Medium</span>
                        </label>
                        <label class="radio-option">
                            <input 
                                type="radio" 
                                name="font_size" 
                                value="large" 
                                ${currentUserSettings?.font_size === 'large' ? 'checked' : ''}
                                onclick="setUserSetting('font_size', 'large')"
                            >
                            <span>Large</span>
                        </label>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input 
                            type="checkbox" 
                            ${currentUserSettings?.reduced_motion ? 'checked' : ''}
                            onclick="setUserSetting('reduced_motion', !currentUserSettings?.reduced_motion)"
                        >
                        <span>Respect system reduced motion preference</span>
                    </label>
                </div>
            </div>
        `;
    }

    // Render system settings UI
    function renderSystemSettings() {
        if (!systemContent) return;
        
        const grouped = {};
        if (systemSettings) {
            systemSettings.forEach(setting => {
                if (!grouped[setting.category]) {
                    grouped[setting.category] = [];
                }
                grouped[setting.category].push(setting);
            });
        }
        
        systemContent.innerHTML = `
            <div class="settings-sections">
                ${Object.entries(grouped).map(([category, settings]) => `
                    <div class="settings-category">
                        <h4>${category}</h4>
                        <div class="settings-grid">
                            ${settings.map(setting => `
                                <div class="setting-item">
                                    <div class="setting-header">
                                        <strong class="setting-key">${setting.key}</strong>
                                        <span class="setting-category">${setting.category}</span>
                                    </div>
                                    <div class="setting-description">${setting.description}</div>
                                    <div class="setting-control">
                                        ${renderSettingControl(setting)}
                                    </div>
                                    <div class="setting-meta">
                                        <span>Updated by: ${setting.updated_by}</span>
                                        <span>${new Date(setting.updated_at).toLocaleString()}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Render appropriate control for setting
    function renderSettingControl(setting) {
        const value = typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value);
        
        switch (setting.key.toLowerCase()) {
            case 'notification_channel':
                return `
                    <select onchange="updateSystemSetting('${setting.key}', this.value)">
                        <option value="email" ${value === 'email' ? 'selected' : ''}>Email</option>
                        <option value="push" ${value === 'push' ? 'selected' : ''}>Push</option>
                        <option value="sms" ${value === 'sms' ? 'selected' : ''}>SMS</option>
                    </select>
                `;
            case 'max_daily_notifications':
                return `<input type="number" value="${value}" onchange="updateSystemSetting('${setting.key}', this.value)" min="0" max="1000">`;
            case 'theme_default':
                return `
                    <select onchange="updateSystemSetting('${setting.key}', this.value)">
                        <option value="light" ${value === 'light' ? 'selected' : ''}>Light</option>
                        <option value="dark" ${value === 'dark' ? 'selected' : ''}>Dark</option>
                        <option value="system" ${value === 'system' ? 'selected' : ''}>System</option>
                    </select>
                `;
            default:
                return `<span class="setting-value">${value}</span>`;
        }
    }

    // User settings action functions
    async function setUserSetting(key, value) {
        if (!currentUserSettings) return;
        
        const originalValue = currentUserSettings[key];
        currentUserSettings[key] = value;
        
        // Update UI immediately
        renderUserSettings();
        
        // Apply theme changes immediately
        if (key === 'theme') {
            applyTheme(value);
        }
        
        try {
            await API.request('/profile/settings', {
                method: 'PATCH',
                body: JSON.stringify({ [key]: value })
            });
            
            // Notify other components
            document.dispatchEvent(new CustomEvent('settings.updated', {
                detail: { userId: window.messageService?.getCurrentUserId(), settings: currentUserSettings }
            }));
            
        } catch (error) {
            console.error('Failed to update setting:', error);
            
            // Revert on error
            currentUserSettings[key] = originalValue;
            renderUserSettings();
            
            if (key === 'theme') {
                applyTheme(originalValue);
            }
            
            showError(`Failed to update ${key}. Please try again.`);
        }
    }

    // System settings action functions
    async function updateSystemSetting(key, value) {
        try {
            await API.request(`/owner/settings/${key}`, {
                method: 'PATCH',
                body: JSON.stringify({ value })
            });
            
            // Update local copy
            if (systemSettings) {
                const setting = systemSettings.find(s => s.key === key);
                if (setting) {
                    setting.value = value;
                }
            }
            
            renderSystemSettings();
            
        } catch (error) {
            console.error('Failed to update system setting:', error);
            showError(`Failed to update ${key}. Please try again.`);
        }
    }

    // Apply theme to document
    function applyTheme(theme) {
        const root = document.documentElement;
        
        // Remove existing theme classes
        root.classList.remove('theme-light', 'theme-dark', 'theme-system');
        
        // Add new theme class
        root.classList.add(`theme-${theme}`);
        
        // Store theme preference
        localStorage.setItem('theme-preference', theme);
    }

    // Handle settings updates from realtime events
    function handleSettingsUpdate(settings) {
        currentUserSettings = { ...currentUserSettings, ...settings };
        renderUserSettings();
        
        if (settings.theme) {
            applyTheme(settings.theme);
        }
    }

    // Update CSS custom properties based on font size
    function updateFontSize(size) {
        const root = document.documentElement;
        
        switch (size) {
            case 'small':
                root.style.setProperty('--font-size-base', '0.875rem');
                root.style.setProperty('--font-size-lg', '1.125rem');
                root.style.setProperty('--font-size-xl', '1.375rem');
                break;
            case 'large':
                root.style.setProperty('--font-size-base', '1.125rem');
                root.style.setProperty('--font-size-lg', '1.375rem');
                root.style.setProperty('--font-size-xl', '1.75rem');
                break;
            default: // medium
                root.style.setProperty('--font-size-base', '1rem');
                root.style.setProperty('--font-size-lg', '1.25rem');
                root.style.setProperty('--font-size-xl', '1.5rem');
                break;
        }
    }

    // Polling for settings updates
    function startPolling() {
        stopPolling();
        isPollingPaused = false;
        pollTimer = setInterval(refreshSettings, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        isPollingPaused = false;
    }

    async function refreshSettings() {
        if (isPollingPaused) return;
        
        try {
            await loadUserSettings();
        } catch (error) {
            console.error('Failed to refresh settings:', error);
        }
    }

    function showError(message) {
        const error = document.createElement('div');
        error.className = 'message error-notification';
        error.textContent = message;
        error.setAttribute('role', 'alert');
        
        document.body.appendChild(error);
        
        setTimeout(() => {
            if (error.parentNode) {
                error.parentNode.removeChild(error);
            }
        }, 3000);
    }

    // Expose public API
    window.Settings = {
        refresh: refreshSettings,
        updateUserSetting: setUserSetting,
        updateSystemSetting: updateSystemSetting,
        getUserSettings: () => currentUserSettings,
        getSystemSettings: () => systemSettings
    };

    (async function init() {
        if (!window.messageService) {
            window.messageService = new (window.MessageService || window.messageService.constructor)();
            await window.messageService.initialize();
        }
        
        await initSettings();
    })();
})();