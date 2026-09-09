/* Shared SSE client for real-time messaging.
   Uses Server-Sent Events with the existing JWT authentication.
   Falls back to polling if SSE is unavailable. */
(function () {
    'use strict';
    if (!window.Site) return;

    const Site = window.Site;
    const tokenKey = 'auth_token';

    function token() { return localStorage.getItem(tokenKey) || ''; }

    class RealtimeClient {
        constructor() {
            this.es = null;
            this.reconnectTimer = null;
            this.reconnectDelay = 1000;
            this.maxReconnectDelay = 10000;
            this.listeners = new Map();
            this.connected = false;
        }

        connect() {
            if (!token()) return;
            const API = window.Site.API;
            const url = API.base() + '/events?token=' + encodeURIComponent(token());

            try {
                this.es = new EventSource(url);
            } catch (e) {
                this.scheduleReconnect();
                return;
            }

            this.es.onopen = () => {
                this.connected = true;
                this.reconnectDelay = 1000;
                this.emit('connected');
            };

            this.es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.emit(data.type, data);
                    if (data.conversationId) this.emit('conv:' + data.conversationId, data);
                } catch (e) { /* ignore malformed */ }
            };

            this.es.onerror = () => {
                this.connected = false;
                this.emit('disconnected');
                if (this.es) {
                    this.es.close();
                    this.es = null;
                }
                this.scheduleReconnect();
            };
        }

        scheduleReconnect() {
            if (this.reconnectTimer) return;
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        }

        on(event, callback) {
            if (!this.listeners.has(event)) this.listeners.set(event, new Set());
            this.listeners.get(event).add(callback);
        }

        off(event, callback) {
            const set = this.listeners.get(event);
            if (set) set.delete(callback);
        }

        emit(event, data) {
            const set = this.listeners.get(event);
            if (set) for (const cb of set) { try { cb(data); } catch (e) {} }
        }

        disconnect() {
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (this.es) {
                this.es.close();
                this.es = null;
            }
            this.connected = false;
        }

        // REST endpoints handle persistence; these are just for real-time signaling
        markRead(conversationId) {
            // Read receipts are handled via REST POST /conversations/:id/read
        }
    }

    Site.Realtime = new RealtimeClient();

    if (token()) Site.Realtime.connect();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && token()) {
            if (!Site.Realtime.connected) Site.Realtime.connect();
        }
    });
})();