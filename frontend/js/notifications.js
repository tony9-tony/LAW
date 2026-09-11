/* Frontend notification system
   Integrates with the existing backend notification APIs and SSE real-time updates */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    let unreadCount = 0;
    let isPollingPaused = false;
    let pollTimer = null;
    const POLL_INTERVAL_MS = 30000;
    const POLL_INTERVAL_HIDDEN_MS = 120000;

    const notificationsContainer = document.getElementById('notifications-container');
    const notificationsPanel = document.getElementById('notifications-panel');
    const notificationsList = document.getElementById('notifications-list');
    const notificationsMeta = document.getElementById('notifications-meta');
    const unreadBadge = document.getElementById('unread-badge');

    function initNotifications() {
        // Set up polling for notifications every POLL_INTERVAL_MS
        loadNotifications();
    }

    function updateNotificationBadge() {
        if (unreadBadge) {
            if (unreadCount > 0) {
                unreadBadge.textContent = unreadCount;
                unreadBadge.style.display = 'flex';
            } else {
                unreadBadge.style.display = 'none';
            }
        }
    }

    function showNotificationToast(notification) {
        if (!notificationsPanel) return;

        const toast = document.createElement('div');
        toast.className = 'notification-toast';
        toast.innerHTML = `
            <div class="notification-toast-content">
                <div class="notification-toast-header">
                    <strong>${escape(notification.title || 'Notification')}</strong>
                    <span class="notification-toast-time">Just now</span>
                </div>
                <div class="notification-toast-body">
                    ${escape(notification.body || '')}
                </div>
            </div>
        `;

        notificationsPanel.insertBefore(toast, notificationsPanel.firstChild);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('removing');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, 5000);
    }

    function loadNotifications() {
        if (!notificationsList) return;

        notificationsList.innerHTML = `
            <div class="empty-state">
                <span class="ico">·</span>
                <strong>Loading notifications...</strong>
            </div>
        `;
        notificationsMeta.textContent = 'Loading…';

        // Use the Site API directly for notifications
        const token = API ? API.token() : '';
        if (token) {
            fetch('/api/v1/notifications?unread=false&limit=50', {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()).then(data => {
                const notifications = (data && data.data) || [];
                unreadCount = notifications.filter(n => !n.read_at).length;
                renderNotifications(notifications);
            }).catch(error => {
                console.error('Failed to load notifications:', error);
                notificationsList.innerHTML = `
                    <div class="empty-state">
                        <span class="ico">!</span>
                        <strong>Could not load notifications.</strong>
                    </div>
                `;
            });
        }
    }

    function renderNotifications(notifications) {
        if (!notificationsList) return;

        if (!notifications.length) {
            notificationsList.innerHTML = `
                <div class="empty-state">
                    <span class="ico">·</span>
                    <strong>No notifications</strong>
                </div>
            `;
            notificationsMeta.textContent = 'All caught up';
            return;
        }

        const totalUnread = notifications.filter(n => !n.read_at).length;
        notificationsMeta.textContent = `${notifications.length} total · ${totalUnread} unread`;

        notificationsList.innerHTML = `
            <div class="notifications-list">
                ${notifications.map(notification => {
                    const isUnread = !notification.read_at;
                    const timeAgo = formatTimeAgo(notification.created_at);
                    return `
                        <div class="notification-item ${isUnread ? 'unread' : ''}" data-id="${notification.id}">
                            <div class="notification-content">
                                <div class="notification-header">
                                    <strong class="notification-title">${escape(notification.title)}</strong>
                                    <span class="notification-time" title="${new Date(notification.created_at).toLocaleString()}">${timeAgo}</span>
                                </div>
                                <div class="notification-body">${escape(notification.body || '')}</div>
                                ${notification.entity_type ? `
                                <div class="notification-entity">
                                    <span class="notification-entity-type">${notification.entity_type}</span>
                                    ${notification.entity_id ? `<span class="notification-entity-id">#${notification.entity_id}</span>` : ''}
                                </div>
                                ` : ''}
                            </div>
                            <div class="notification-actions">
                                <button class="btn btn-sm secondary" onclick="markNotificationRead('${notification.id}')">Mark as read</button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Attach event listeners
        notificationsList.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', () => {
                const notificationId = item.getAttribute('data-id');
                viewNotificationDetails(notificationId);
            });
        });
    }

    function refreshNotifications() {
        loadNotifications();
    }

    function formatTimeAgo(createdAt) {
        const now = new Date();
        const created = new Date(createdAt);
        const diffInSeconds = Math.floor((now - created) / 1000);

        if (diffInSeconds < 60) return 'Just now';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
        if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d`;

        return created.toLocaleDateString();
    }

    function viewNotificationDetails(notificationId) {
        markNotificationRead(notificationId);
    }

    async function markNotificationRead(notificationId) {
        const token = API ? API.token() : '';
        if (!token) return false;

        try {
            await fetch(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            loadNotifications();
            updateNotificationBadge();
            return true;
        } catch (error) {
            console.error('Failed to mark notification as read:', error);
            return false;
        }
    }

    function toggleNotificationsPanel() {
        if (notificationsPanel) {
            const isHidden = notificationsPanel.style.display === 'none' || !notificationsPanel.style.display;
            notificationsPanel.style.display = isHidden ? 'block' : 'none';
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshNotifications();
        }
    });

    (async function init() {
        initNotifications();
    })();
})();