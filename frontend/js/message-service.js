/* Unified message service that integrates MessageHandler with REST API
   Provides complete messaging functionality with real-time updates */
(function () {
    'use strict';
    
    class MessageService {
        constructor() {
            this.messageHandler = new MessageHandler();
            this.conversationCache = new Map();
            this.isInitialized = false;
            this.isSetupComplete = false;
        }
        
        // Initialize the service
        async initialize() {
            if (this.isInitialized) return;
            this.isInitialized = true;
            
            // Setup message handler integration (only once)
            if (!this.isSetupComplete) {
                this.isSetupComplete = true;
                this.setupMessageHandler();
            }
            
            // Connect to SSE
            try {
                await this.messageHandler.connect();
            } catch (error) {
                console.error('Failed to connect SSE:', error);
                // Schedule reconnection for later
                setTimeout(() => {
                    this.isInitialized = false;
                    this.initialize();
                }, 5000);
            }
            
            this.isInitialized = true;
        }
        
        // Setup message handler event integration
        setupMessageHandler() {
            // Listen for conversation updates
            this.messageHandler.on('conversation.updated', (conversationId, conversation) => {
                this.conversationCache.set(conversationId, conversation);
                this.notifyUIComponents('conversationUpdated', conversationId, conversation);
            });
            
            // Listen for specific event types
            this.messageHandler.on('message.created', (conversationId, message, data) => {
                this.notifyUIComponents('messageCreated', conversationId, message, data);
            });
            
            this.messageHandler.on('message.read', (conversationId, messageId, readBy) => {
                this.notifyUIComponents('messageRead', conversationId, messageId, readBy);
            });
            
            this.messageHandler.on('message.typing', (conversationId, userId, userName, isTyping) => {
                this.notifyUIComponents('messageTyping', conversationId, userId, userName, isTyping);
            });
            
            this.messageHandler.on('message.reaction_added', (conversationId, messageId, emoji, userId) => {
                this.notifyUIComponents('messageReactionAdded', conversationId, messageId, emoji, userId);
            });
            
            this.messageHandler.on('message.reaction_removed', (conversationId, messageId, emoji, userId) => {
                this.notifyUIComponents('messageReactionRemoved', conversationId, messageId, emoji, userId);
            });
        }
        
        // Core messaging operations
        async sendMessage(conversationId, body, parentMessageId = null) {
            const token = this.getAuthToken();
            if (!token) throw new Error('Not authenticated');
            
            const requestBody = {
                body: body.trim(),
                parentMessageId: parentMessageId || null
            };
            
            const response = await fetch(`/api/v1/conversations/${conversationId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Failed to send message');
            }
            
            const message = await response.json();
            
            // Update local cache
            let conversation = this.conversationCache.get(conversationId);
            if (!conversation) {
                conversation = { messages: [], unreadCount: 0, lastMessageAt: null };
                this.conversationCache.set(conversationId, conversation);
            }
            
            // Add message to conversation
            conversation.messages.push(message.data);
            conversation.lastMessageAt = message.data.created_at;
            if (message.data.sender_id !== this.getCurrentUserId()) {
                conversation.unreadCount = (conversation.unreadCount || 0) + 1;
            }
            
            this.conversationCache.set(conversationId, conversation);
            this.notifyUIComponents('messageSent', conversationId, message.data);
            
            return message.data;
        }
        
        // Load conversation with pagination
        async loadConversation(conversationId, afterEventId = null) {
            const token = this.getAuthToken();
            if (!token) throw new Error('Not authenticated');
            
            let url = `/api/v1/conversations/${conversationId}/messages?limit=50`;
            if (afterEventId) {
                url += `&after=${afterEventId}`;
            }
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to load conversation');
            }
            
            const data = await response.json();
            let conversation = this.conversationCache.get(conversationId);
            if (!conversation) {
                conversation = { messages: [], unreadCount: 0, lastMessageAt: null };
                this.conversationCache.set(conversationId, conversation);
            }
            
            // Replace messages with fresh data
            conversation.messages = data.data.messages;
            conversation.lastMessageAt = data.data.messages.length > 0 ? 
                data.data.messages[data.data.messages.length - 1].created_at : null;
            
            this.conversationCache.set(conversationId, conversation);
            this.notifyUIComponents('conversationLoaded', conversationId, conversation);
            
            return conversation;
        }
        
        // Mark messages as read
        async markMessagesRead(conversationId, messageIds) {
            const token = this.getAuthToken();
            if (!token) throw new Error('Not authenticated');
            
            const response = await fetch(`/api/v1/conversations/${conversationId}/read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ messageIds })
            });
            
            if (!response.ok) {
                throw new Error('Failed to mark messages as read');
            }
            
            // Update local state
            const conversation = this.conversationCache.get(conversationId);
            if (conversation) {
                conversation.unreadCount = 0;
                this.conversationCache.set(conversationId, conversation);
                this.notifyUIComponents('messagesRead', conversationId);
            }
        }
        
        // Get conversation participants
        async getConversationParticipants(conversationId) {
            const token = this.getAuthToken();
            if (!token) throw new Error('Not authenticated');
            
            const response = await fetch(`/api/v1/conversations/${conversationId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to get conversation details');
            }
            
            const data = await response.json();
            return data.data;
        }
        
        // Utility methods
        getAuthToken() {
            return localStorage.getItem('auth_token') || '';
        }
        
        getCurrentUserId() {
            const user = window.Site.API.user();
            return user ? user.id : null;
        }
        
        notifyUIComponents(event, ...args) {
            // Notify all UI components listening for message events
            document.dispatchEvent(new CustomEvent('message:' + event, {
                detail: args
            }));
        }
        
        // Cleanup
        destroy() {
            if (this.messageHandler) {
                this.messageHandler.destroy();
            }
            this.conversationCache.clear();
            this.isInitialized = false;
        }
    }
    
    // Create singleton instance
    const messageService = new MessageService();
    
    // Export for use in other modules
    if (typeof window !== 'undefined') {
        window.MessageService = MessageService;
        window.messageService = messageService;
    }
})();