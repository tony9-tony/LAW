/* Portal — practice areas. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;

    (function () {
        'use strict';
        const params = new URLSearchParams(location.search);
        const area = params.get('area');
        if (!area) return;

        const map = {
            Civil: 'Civil',
            Commercial: 'Commercial',
            Family: 'Family',
            Property: 'Property',
            Employment: 'Employment'
        };

        const normalized = map[area] ? map[area].toLowerCase() : null;
        if (!normalized) return;

        const form = document.getElementById('custom-matter-form');
        if (!form) return;

        const radio = form.querySelector('input[name="matterType"][value="' + normalized + '"]');
        if (radio) {
            radio.checked = true;
            radio.closest('.choice-card')?.classList.add('selected');
        }
    })();
})();
