/* Rate the firm: star rating + comment form on the public website. */
(function () {
    'use strict';
    const form = document.getElementById('rate-form');
    if (!form) return;
    const WORDS = { 1: 'Very poor', 2: 'Poor', 3: 'Fair', 4: 'Good', 5: 'Excellent' };
    const word = document.getElementById('star-word');
    const status = document.getElementById('rate-status');

    form.querySelectorAll('input[name="rating"]').forEach((r) => r.addEventListener('change', () => {
        word.textContent = `${r.value} of 5 · ${WORDS[r.value]}`;
        form.querySelector('.star-input').classList.remove('invalid');
    }));

    function say(text, kind) {
        status.textContent = text;
        status.className = 'rate-status' + (kind ? ' ' + kind : '');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (!data.rating) { form.querySelector('.star-input').classList.add('invalid'); say('Please choose 1 to 5 stars.', 'error'); return; }
        if (!data.name || data.name.trim().length < 2) { say('Please write your name.', 'error'); form.name.focus(); return; }
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        say('Sending…');
        try {
            const base = (window.Site && window.Site.API) ? window.Site.API.base() : '/api/v1';
            const res = await fetch(base + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error((body.error && body.error.message) || 'Please try again.');
            form.innerHTML = `<div class="rate-thanks"><div class="rate-thanks-stars" aria-hidden="true">${'<span class="on"></span>'.repeat(Number(data.rating))}${'<span></span>'.repeat(5 - Number(data.rating))}</div><h3>Thank you, ${data.name.trim().split(' ')[0].replace(/[<>&"]/g, '')}!</h3><p>Your rating has reached the firm. It helps us serve you better.</p></div>`;
        } catch (err) {
            say('Could not send: ' + err.message, 'error');
            button.disabled = false;
        }
    });
})();
