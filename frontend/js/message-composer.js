/* Professional message composer component for the messaging system
   Provides rich message composition with formatting, character counting, and professional UI */
(function () {
    'use strict';
    
    class MessageComposer {
        constructor(container, options = {}) {
            this.container = container;
            this.conversationId = options.conversationId;
            this.maxLength = options.maxLength || 4000;
            this.allowFormatting = options.allowFormatting || false;
            this.onSend = options.onSend || (() => {});
            this.onCancel = options.onCancel || (() => {});
            this.onTyping = options.onTyping;
            
            this.isComposing = false;
            this.typingTimeout = null;
            
            this.init();
        }
        
        init() {
            this.render();
            this.attachEvents();
        }
        
        render() {
            this.container.innerHTML = `
                <div class="message-composer" role="form" aria-label="Message composer">
                    <div class="composer-header">
                        <span class="composer-title" id="composer-title">New Message</span>
                        <span class="character-count" id="char-count" aria-live="polite">0 / ${this.maxLength}</span>
                    </div>
                    <div class="composer-input-container">
                        <textarea 
                            id="composer-input" 
                            class="composer-input" 
                            placeholder="Type your message..."
                            maxlength="${this.maxLength}"
                            aria-label="Message content"
                        ></textarea>
                    </div>
                    <div class="composer-footer">
                        <button 
                            type="button" 
                            id="composer-cancel" 
                            class="btn-secondary"
                            aria-label="Cancel message composition"
                        >Cancel</button>
                        <button 
                            type="button" 
                            id="composer-send" 
                            class="btn-primary" 
                            disabled
                            aria-label="Send message"
                        >Send</button>
                    </div>
                </div>
            `;
            
            this.textarea = this.container.querySelector('#composer-input');
            this.sendBtn = this.container.querySelector('#composer-send');
            this.cancelBtn = this.container.querySelector('#composer-cancel');
            this.charCount = this.container.querySelector('#char-count');
        }
        
        attachEvents() {
            this.textarea.addEventListener('input', this.handleInput.bind(this));
            this.textarea.addEventListener('keydown', this.handleKeyDown.bind(this));
            this.sendBtn.addEventListener('click', this.handleSend.bind(this));
            this.cancelBtn.addEventListener('click', this.handleCancel.bind(this));
            
            // Handle focus/blur for typing indicators
            this.textarea.addEventListener('focus', this.handleFocus.bind(this));
            this.textarea.addEventListener('blur', this.handleBlur.bind(this));
        }
        
        handleInput() {
            const length = this.textarea.value.length;
            this.charCount.textContent = `${length} / ${this.maxLength}`;
            
            this.sendBtn.disabled = length === 0 || length > this.maxLength;
            
            // Emit typing event for other participants
            if (this.onTyping) {
                clearTimeout(this.typingTimeout);
                this.typingTimeout = setTimeout(() => {
                    this.onTyping({ isTyping: true });
                    // Reset typing after 3 seconds of inactivity
                    setTimeout(() => {
                        if (this.textarea.value.length > 0) {
                            this.onTyping({ isTyping: false });
                        }
                    }, 3000);
                }, 500);
            }
        }
        
        handleKeyDown(e) {
            // Enter + Ctrl/Cmd for send, Enter alone for new line (in textarea)
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.handleSend();
            }
        }
        
        handleFocus() {
            if (this.onTyping) {
                this.onTyping({ isTyping: true });
            }
        }
        
        handleBlur() {
            if (this.onTyping) {
                setTimeout(() => {
                    if (!this.textarea.value) {
                        this.onTyping({ isTyping: false });
                    }
                }, 100);
            }
        }
        
        async handleSend() {
            const body = this.textarea.value.trim();
            if (!body) return;
            
            this.setLoadingState(true);
            
            try {
                await this.onSend(body);
                this.clear();
            } catch (error) {
                console.error('Failed to send message:', error);
                this.showError('Failed to send message. Please try again.');
            } finally {
                this.setLoadingState(false);
            }
        }
        
        handleCancel() {
            this.clear();
            if (this.onTyping) {
                this.onTyping({ isTyping: false });
            }
        }
        
        setLoadingState(loading) {
            this.isComposing = loading;
            this.sendBtn.disabled = loading;
            this.sendBtn.textContent = loading ? 'Sending...' : 'Send';
            this.textarea.disabled = loading;
            this.cancelBtn.disabled = loading;
        }
        
        showError(message) {
            // Show error notification
            const notification = document.createElement('div');
            notification.className = 'message error-notification';
            notification.textContent = message;
            notification.setAttribute('role', 'alert');
            
            this.container.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 3000);
        }
        
        clear() {
            this.textarea.value = '';
            this.handleInput();
            this.textarea.focus();
        }
        setConversationId(conversationId) {
            this.conversationId = conversationId;
        }
        
        setOnSend(callback) {
            this.onSend = callback;
        }
        
        setOnTyping(callback) {
            this.onTyping = callback;
        }
        
        focus() {
            this.textarea.focus();
        }
    }
    
    // Export MessageComposer
    if (typeof window !== 'undefined') {
        window.MessageComposer = MessageComposer;
    }
})();