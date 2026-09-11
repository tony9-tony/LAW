/* Shared message handling core for real-time messaging
   Provides event deduplication, conversation state management, and message processing */
(function () {
    'use strict';
    
    class MessageHandler {
        constructor() {
            this.conversations = new Map();
            this.eventIds = new Set();
            this.eventIdCounter = 1;
            this.listeners = new Map();
            this.isPollingPaused = false;
        }
        
        // Handle incoming SSE events with deduplication
        handleEvent(event) {
            // Generate event ID if not provided
            const eventId = event.id || this.generateEventId();
            
            // Deduplicate events to prevent duplicates
            if (this.eventIds.has(eventId)) {
                return;
            }
            this.eventIds.add(eventId);
            
            const { type, conversationId, message, ...data } = event;
            
            // Ensure conversation exists
            if (!this.conversations.has(conversationId)) {
                this.conversations.set(conversationId, {
                    messages: [],
                    unreadCount: 0,
                    lastMessageAt: null,
                    participants: new Set(),
                    typingUsers: new Set(),
                    lastEventId: null
                });
            }
            
            const conversation = this.conversations.get(conversationId);
            
            switch (type) {
                case 'message.created':
                    this.handleMessageCreated(conversation, message, data);
                    break;
                case 'message.read':
                    this.handleMessageRead(conversation, message.id, data.readBy);
                    break;
                case 'message.typing':
                    this.handleTypingIndicator(conversation, data);
                    break;
                case 'message.reaction_added':
                case 'message.reaction_removed':
                    this.handleReaction(conversation, data);
                    break;
                case 'message.delivered':
                    this.handleMessageDelivered(conversation, message.id, data.deliveredTo);
                    break;
                default:
                    console.warn('Unknown event type:', type);
            }
            
            // Notify listeners
            this.notifyListeners('conversation.updated', conversationId, conversation);
            this.notifyListeners(type, conversationId, message, data);
        }
        
        // Process new message
        handleMessageCreated(conversation, message, data) {
            const isOwnMessage = data.senderId === this.getCurrentUserId();
            
            if (!isOwnMessage) {
                conversation.unreadCount = (conversation.unreadCount || 0) + 1;
            }
            
            // Check if message already exists
            const existingIndex = conversation.messages.findIndex(m => m.id === message.id);
            if (existingIndex === -1) {
                // Insert at beginning for real-time feel
                conversation.messages.unshift(message);
                conversation.lastMessageAt = message.created_at;
                conversation.lastEventId = data.timestamp;
            }
            
            // Clean up old messages to prevent memory leaks
            if (conversation.messages.length > 100) {
                conversation.messages = conversation.messages.slice(0, 100);
            }
        }
        
        // Process message read event
        handleMessageRead(conversation, messageId, readBy) {
            // Update read status
            conversation.messages.forEach(msg => {
                if (msg.id === messageId) {
                    msg.readBy = msg.readBy || [];
                    if (!msg.readBy.includes(readBy)) {
                        msg.readBy.push(readBy);
                    }
                }
            });
            
            // Update unread count
            conversation.unreadCount = Math.max(0, conversation.unreadCount - 1);
        }
        
        // Handle typing indicator
        handleTypingIndicator(conversation, data) {
            if (data.isTyping) {
                conversation.typingUsers.add(data.userId);
            } else {
                conversation.typingUsers.delete(data.userId);
            }
        }
        
        // Handle reactions
        handleReaction(conversation, data) {
            // Find message and update reactions
            const message = conversation.messages.find(m => m.id === data.messageId);
            if (message) {
                if (!message.reactions) message.reactions = {};
                if (data.action === 'add') {
                    if (!message.reactions[data.emoji]) message.reactions[data.emoji] = [];
                    message.reactions[data.emoji].push(data.userId);
                } else {
                    if (message.reactions && message.reactions[data.emoji]) {
                        const index = message.reactions[data.emoji].indexOf(data.userId);
                        if (index > -1) {
                            message.reactions[data.emoji].splice(index, 1);
                        }
                    }
                }
            }
        }
        
        // Handle message delivered
        handleMessageDelivered(conversation, messageId, deliveredTo) {
            const message = conversation.messages.find(m => m.id === messageId);
            if (message) {
                message.deliveredTo = message.deliveredTo || [];
                if (!message.deliveredTo.includes(deliveredTo)) {
                    message.deliveredTo.push(deliveredTo);
                }
            }
        }
        
        // Connection management
        connect() {
            if (!this.getCurrentUserId()) return Promise.reject('No authenticated user');
            
            const url = window.Site.API.base() + '/events?token=' + encodeURIComponent(this.getCurrentUserToken());
            
            return new Promise((resolve, reject) => {
                try {
                    this.es = new EventSource(url);
                    this.setupEventHandlers(resolve, reject);
                } catch (error) {
                    reject(error);
                }
            });
        }
        
        setupEventHandlers(resolve, reject) {
            this.es.onopen = () => {
                this.connected = true;
                this.reconnectDelay = 1000;
                resolve();
            };
            
            this.es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    data.id = event.lastEventId || this.generateEventId();
                    this.handleEvent(data);
                } catch (error) {
                    console.error('Error parsing SSE message:', error);
                }
            };
            
            this.es.onerror = () => {
                this.connected = false;
                this.scheduleReconnect();
                reject(new Error('SSE connection error'));
            };
        }
        
        scheduleReconnect() {
            if (this.reconnectTimer) return;
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
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
        
        // Event listeners
        on(event, callback) {
            if (!this.listeners.has(event)) {
                this.listeners.set(event, new Set());
            }
            this.listeners.get(event).add(callback);
        }
        
        off(event, callback) {
            const listeners = this.listeners.get(event);
            if (listeners) {
                listeners.delete(callback);
            }
        }
        
        notifyListeners(event, ...args) {
            const listeners = this.listeners.get(event);
            if (listeners) {
                listeners.forEach(callback => {
                    try {
                        callback(...args);
                    } catch (error) {
                        console.error('Error in event listener:', error);
                    }
                });
            }
        }
        
        // Utility methods
        generateEventId() {
            return 'evt_' + Date.now() + '_' + this.eventIdCounter++;
        }
        
        hasProcessedEvent(eventId) {
            return this.eventIds.has(eventId);
        }
        
        markEventProcessed(eventId) {
            this.eventIds.add(eventId);
        }
        
        getCurrentUserId() {
            const user = window.Site.API.user();
            return user ? user.id : null;
        }
        
        getCurrentUserToken() {
            return localStorage.getItem('auth_token') || '';
        }
        
        // Poll for missed messages during reconnect
        async pollMissedMessages(conversationId, afterEventId = null) {
            if (!this.getCurrentUserId()) return [];
            
            try {
                let url = window.Site.API.base() + `/conversations/${conversationId}/messages?limit=50`;
                if (afterEventId) {
                    url += `&after=${afterEventId}`;
                }
                
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.getCurrentUserToken()}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    return data.data.messages || [];
                }
                return [];
            } catch (error) {
                console.error('Error polling for missed messages:', error);
                return [];
            }
        }
        
        // Cleanup
        destroy() {
            this.disconnect();
            this.conversations.clear();
            this.eventIds.clear();
            this.listeners.clear();
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
        }
    }
    
    // Export MessageHandler
    window.MessageHandler = MessageHandler;
})();