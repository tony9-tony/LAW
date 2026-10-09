/* Controlled public knowledge for the AI Support assistant.
   ONLY verified, public information about the LAW platform. No prices, no
   private data, no contact details beyond what the public site publishes.
   Every FAQ has an English and a Kiswahili version. */
export const SUPPORT_IDENTITY = {
    en: 'I am the ET CETRA support assistant. I can explain how this website works, but I am not a lawyer and I cannot give legal advice.',
    sw: 'Mimi ni msaidizi wa usaidizi wa ET CETRA. Naweza kueleza jinsi tovuti hii inavyofanya kazi, lakini mimi si wakili wala siwezi kutoa ushauri wa kisheria.'
};
export const SUPPORT_GREETING = {
    en: 'Hello! How can I help you today? Ask me about consultations, requests, payments, or choose a quick action below.',
    sw: 'Habari! Nawezaje kukusaidia leo? Niulize kuhusu ushauri, maombi, malipo, au chagua hatua haraka hapa chini.'
};
export const SUPPORT_FALLBACK = {
    en: 'I do not have that information. Please use Contact Office and the firm will assist you directly.',
    sw: 'Sina taarifa hizo. Tafadhali tumia Wasiliana na Ofisi na kampuni itakusaidia moja kwa moja.'
};
export const SUPPORT_REFUSAL = {
    en: 'I cannot perform that action here — this chat is for guidance only and cannot access accounts, payments, matters, messages, invoices, or documents. Please sign in to the Client Portal to continue, or use Contact Office for help.',
    sw: 'Siwezi kutekeleza kitendo hicho hapa — gumzo hili ni la maelekezo tu wala haliwezi kufikia akaunti, malipo, mashauri, ujumbe, ankara, wala nyaraka. Tafadhali ingia kwenye Mlango wa Mteja ili kuendelea, au tumia Wasiliana na Ofisi kwa msaada.'
};
export const SUPPORT_LINKS = {
    bookConsultation: 'login.html?next=consultation.html',
    makeRequest: 'login.html?next=custom-matter.html',
    contact: 'contact.html',
    howItWorks: 'how-it-works.html',
    login: 'login.html',
    faqSection: 'how-it-works.html#faq'
};

/* The ONLY facts the AI model is given (with the FAQ answers below). Everything
   here is already published on the website. Never add internal information:
   staff, other clients, amounts, accounts, systems, addresses of the admin
   console, or anything that is not on a public page. */
export const PUBLIC_FACTS = `
Firm: ET CETRA ADVOCATES COMPANY LIMITED, Advocates & Legal Counsel. Advocate: Emmanuel Richard Machibya, a practising advocate with more than ten years of experience. He handles every matter of the firm personally.
Office: Posta, Kisutu, Tanzania. Office visits are by appointment only; book a consultation before travelling.
Phone and WhatsApp (both numbers take calls and WhatsApp): +255 714 840 951 and +255 657 259 584.
Practice areas: civil litigation and disputes; commercial matters and contracts (company registration, shareholder agreements, business contracts); family law (marriage and divorce, custody and guardianship, probate and succession); property and land (title checks, land transfer, leases, boundary disputes, conveyancing); employment law (contracts, termination, disciplinary matters, workplace disputes). Other matters: choose "Other" in the request form; the advocate says whether the firm can help.
Website pages: Home (index.html), About (about.html), How it works with the full FAQ (how-it-works.html), Legal insights (legal-insights.html), Contact (contact.html), Sign in (login.html), Create account (register.html).
Client portal (after signing in): Dashboard, New request, Book consultation, My requests, My matters, Messages, Appointments, Documents, Invoices, Payments, Notifications, Practice areas, Profile.
Request path: create a free account; press New request and fill a short 5-step form (type of matter, what happened, how you want help, contact, review and submit); the advocate reviews it and may ask for more information ("Action required"); if accepted an invoice appears under Invoices; pay with the Lipa Namba shown on that invoice and upload the receipt with the transaction reference; when the firm confirms the payment the invoice shows Paid and the matter opens with its own reference (for example M-ABC123); then use Messages, Documents and Appointments until the matter is closed. A declined request shows the reason and is not charged.
Consultation path: sign in, open Book consultation, choose the type (initial, follow-up, document review, advisory), the format (in person, phone or video) and a preferred time; the firm confirms it in the portal with the consultation invoice; pay before the meeting; the appointment then shows under Appointments.
Payments: only by the Lipa Namba shown inside the client's own invoice (any mobile network), with the invoice number as the reference; then upload the receipt. The firm never asks anyone to pay to a person's number. Amounts are on each invoice; this assistant does not know fees.
Statuses: Submitted, Under review, Action required, Accepted, Declined, Payment required, Pending verification, Paid, Open, Active, Resolved, Closed.
Account: free; full name, email and a password of at least 12 characters. A sign-in lasts 8 hours. Change your name and password under Profile. To change the sign-in email, message the firm.
Forgotten password: the portal sends no e-mails. Call or WhatsApp the firm; they set a temporary password and give it directly; sign in with it, then choose your own under Profile, Change password.
Privacy: only the client and the firm can see the client's requests, documents, invoices and messages. This assistant cannot see any account.
`.trim();
export const SUPPORT_QUICK_ACTIONS = [
    { id: 'book', en: 'Book Consultation', sw: 'Weka Miadi ya Ushauri' },
    { id: 'payments', en: 'How Payments Work', sw: 'Jinsi Malipo Yanavyofanya Kazi' },
    { id: 'request', en: 'Make a Request', sw: 'Wasilisha Ombi' },
    { id: 'contact', en: 'Contact Office', sw: 'Wasiliana na Ofisi' },
    { id: 'faq', en: 'FAQ', sw: 'Maswali' }
];
export const SUPPORT_FAQ = [
    {
        id: 'what-is-firm',
        topics: ['firm', 'kampuni', 'about', 'kuhusu', 'who', 'nani', 'et cetra', 'machibya', 'ceo', 'owner', 'founder', 'director', 'boss', 'head of', 'who leads', 'who runs', 'mmiliki', 'mkurugenzi', 'bosi', 'mwanzilishi', 'kiongozi'],
        en: {
            q: 'Who is ET CETRA?',
            a: 'ET CETRA ADVOCATES COMPANY LIMITED is an advocates\' firm in Posta, Kisutu, Tanzania, led by Emmanuel Richard Machibya, Advocate & Legal Counsel, who handles every matter personally. It works on civil disputes, commercial matters and contracts, family law, property and land, and employment law, with a private online client portal.'
        },
        sw: {
            q: 'ET CETRA ni nani?',
            a: 'ET CETRA ADVOCATES COMPANY LIMITED ni kampuni ya mawakili iliyopo Posta, Kisutu, Tanzania, chini ya Emmanuel Richard Machibya, Wakili na Mshauri wa Kisheria, anayeshughulikia kila shauri mwenyewe. Inashughulikia migogoro ya madai, biashara na mikataba, sheria za familia, ardhi na mali, na sheria za kazi, kupitia portal ya mteja mtandaoni.'
        }
    },
    {
        id: 'how-it-works',
        /* Only specific phrases: a bare 'how' made this answer win every "how do I..." question. */
        topics: ['how it works', 'how does it work', 'process', 'steps', 'hatua', 'jinsi inavyofanya kazi', 'start', 'begin', 'anzisha'],
        en: {
            q: 'How does it work?',
            a: 'Create a free account, send a request (or book a consultation), and the advocate reviews it. If accepted, an invoice appears in your portal; pay with the Lipa Namba on it and upload the receipt. Once the payment is confirmed your matter opens and you follow it with Messages, Documents and Appointments. The full steps and FAQ are on the How it works page.'
        },
        sw: {
            q: 'Inafanyaje kazi?',
            a: 'Fungua akaunti bure, tuma ombi (au weka miadi ya ushauri), na wakili analipitia. Likikubaliwa, ankara inaonekana kwenye portal yako; lipa kwa Lipa Namba iliyo kwenye ankara na upakie risiti. Malipo yakithibitishwa shauri lako linafunguliwa, na unalifuatilia kupitia Messages, Documents na Appointments. Hatua kamili na maswali yako kwenye ukurasa wa How it works.'
        }
    },
    {
        id: 'consultation',
        topics: ['consultation', 'ushauri', 'appointment', 'miadi', 'book', 'weka', 'meeting'],
        en: {
            q: 'How do I book a consultation?',
            a: 'Sign in (or create a free account) and open Book consultation. Choose the type, the format (in person, phone or video) and a preferred time, and send it. The firm confirms it in your portal with the consultation invoice; pay before the meeting and it shows under Appointments.'
        },
        sw: {
            q: 'Nawezaje kuweka miadi ya ushauri?',
            a: 'Ingia (au fungua akaunti bure) na ufungue Book consultation. Chagua aina, njia (ana kwa ana, simu au video) na muda unaopendelea, kisha tuma. Kampuni inathibitisha kwenye portal yako pamoja na ankara ya ushauri; lipa kabla ya kikao na miadi itaonekana kwenye Appointments.'
        }
    },
    {
        id: 'request',
        topics: ['request', 'ombi', 'matter', 'shauri', 'submit', 'wasilisha', 'create', 'fungua', 'intake'],
        en: {
            q: 'How do I make a request?',
            a: 'Sign in and press New request. A short 5-step form asks for the type of matter, what happened, how you want help and your contact details; review it and submit. The advocate reviews it, may ask for more information, and if it is accepted an invoice appears. Your matter opens once the payment is confirmed.'
        },
        sw: {
            q: 'Nawezaje kuwasilisha ombi?',
            a: 'Ingia na ubonyeze New request. Fomu fupi ya hatua 5 inauliza aina ya shauri, kilichotokea, msaada unaotaka na mawasiliano yako; ipitie kisha wasilisha. Wakili analipitia, anaweza kuomba taarifa zaidi, na likikubaliwa ankara inaonekana. Shauri lako linafunguliwa malipo yakithibitishwa.'
        }
    },
    {
        id: 'payments',
        topics: ['payment', 'malipo', 'pay', 'lipa', 'invoice', 'ankara', 'qr', 'bank', 'benki', 'receipt', 'risiti', 'proof'],
        en: {
            q: 'How do payments work?',
            a: 'When payment is required, an invoice appears in your portal with a Pay Now section. Payment is by Lipa Namba only, and it works from every mobile network and every bank. Pay to the Lipa Namba shown there (or scan its QR code), then upload your payment proof with a reference. The firm reviews the proof and, once approved, the invoice is marked as paid. Only signed-in clients can pay, inside the portal.'
        },
        sw: {
            q: 'Malipo yanafanyaje kazi?',
            a: 'Malipo yanapohitajika, ankara inaonekana kwenye mlango wako na sehemu ya Lipa Sasa. Malipo ni kwa Lipa Namba tu, na inafanya kazi kwa mitandao yote ya simu na benki zote. Lipa kwenye Lipa Namba iliyoonyeshwa (au changanua QR code yake), kisha pakia uthibitisho wa malipo pamoja na kumbukumbu. Kampuni inapitia na, ukiidhinishwa, ankara inawekwa alama ya kulipwa.'
        }
    },
    {
        id: 'lipa-qr',
        topics: ['lipa number', 'namba ya lipa', 'qr code', 'qr'],
        en: {
            q: 'Where do I find the Lipa Number and QR code?',
            a: 'The correct Lipa Number and QR code are shown inside your own invoice Pay Now section in the portal — always use exactly what is displayed there. I cannot show account-specific payment details here in public chat.'
        },
        sw: {
            q: 'Namba ya Lipa na QR code nazipata wapi?',
            a: 'Namba sahihi ya Lipa na QR code zinaonyeshwa ndani ya sehemu ya Lipa Sasa ya ankara yako kwenye mlango — tumia kile kinachoonyeshwa hapo. Siwezi kuonyesha maelezo ya malipo ya akaunti hapa.'
        }
    },
    {
        id: 'status',
        topics: ['status', 'hali', 'track', 'fuatilia', 'progress', 'maendeleo', 'awaiting', 'subiri', 'pending'],
        en: {
            q: 'How do I track my request or payment?',
            a: 'Sign in and open your requests, invoices, and notifications in the portal. A submitted payment shows as awaiting verification until the firm approves it; a paid invoice shows as paid. If payment is approved but the request still awaits processing, message the office from your portal.'
        },
        sw: {
            q: 'Nawezaje kufuatilia ombi au malipo yangu?',
            a: 'Ingia na ufungue maombi, ankara na arifa zako kwenye mlango. Malipo yaliyowasilishwa yanaonyeshwa yanasubiri uthibitisho hadi kampuni iidhinishe; ankara iliyolipwa inaonyeshwa imelipwa.'
        }
    },
    {
        id: 'contact',
        topics: ['contact', 'wasiliana', 'office', 'ofisi', 'phone', 'simu', 'email', 'barua', 'hours', 'muda', 'location', 'mahali'],
        en: {
            q: 'How do I contact the office?',
            a: 'Call or WhatsApp the firm on +255 714 840 951 or +255 657 259 584. The office is in Posta, Kisutu, Tanzania, and visits are by appointment only. To start a matter, send a request or book a consultation in the client portal. Signed-in clients can also message the firm from their matter.'
        },
        sw: {
            q: 'Ninawezaje kuwasiliana na ofisi?',
            a: 'Piga simu au tuma WhatsApp kwa +255 714 840 951 au +255 657 259 584. Ofisi iko Posta, Kisutu, Tanzania, na ziara ni kwa miadi tu. Kuanza shauri, tuma ombi au weka miadi ya ushauri kwenye portal ya mteja. Wateja walioingia wanaweza pia kutuma ujumbe kwenye shauri lao.'
        }
    },
    {
        id: 'account',
        topics: ['account', 'akaunti', 'register', 'jisajili', 'sign', 'ingia', 'login'],
        en: {
            q: 'Do I need an account?',
            a: 'You can chat with me and read these answers without an account. To book, submit a request, pay, message the firm, or view documents, sign in or create a free client account first. Forgot your password? The portal sends no e-mails: call or WhatsApp the firm (+255 714 840 951 or +255 657 259 584); they set a temporary password, then you change it under Profile.'
        },
        sw: {
            q: 'Je, nahitaji akaunti?',
            a: 'Unaweza kuzungumza nami na kusoma majibu haya bila akaunti. Kuweka miadi, kuwasilisha ombi, kulipa, kutuma ujumbe, au kuangalia nyaraka, ingia au fungua akaunti ya mteja bure kwanza. Umesahau nenosiri? Portal haitumi barua pepe: piga simu au tuma WhatsApp kwa kampuni (+255 714 840 951 au +255 657 259 584), itakuwekea nenosiri la muda, kisha ulibadilishe kwenye Profile.'
        }
    },
    {
        id: 'documents',
        topics: ['document', 'nyaraka', 'file', 'upload', 'pakia', 'download', 'pakua'],
        en: {
            q: 'How do documents work?',
            a: 'Documents are exchanged inside your signed-in portal — upload requested files and view or download what the firm shares with you. I cannot access any documents here in public chat.'
        },
        sw: {
            q: 'Nyaraka zinafanyaje kazi?',
            a: 'Nyaraka hubadilishana ndani ya mlango wako baada ya kuingia — pakia faili zinazoombwa na kuangalia au kupakua kile kampuni inachoshiriki nawe.'
        }
    },
    {
        id: 'services',
        topics: ['do you handle', 'can you help with', 'practice area', 'services', 'divorce', 'land case', 'land dispute', 'employment', 'contract', 'company registration', 'inheritance', 'probate', 'mnashughulikia', 'mnasaidia', 'huduma', 'ardhi', 'talaka', 'familia', 'mirathi', 'mikataba', 'biashara', 'ajira', 'sheria za kazi', 'migogoro'],
        en: {
            q: 'What kind of matters does the firm handle?',
            a: 'The firm handles civil litigation and disputes; commercial matters and contracts (such as company registration and shareholder agreements); family law (marriage and divorce, custody, probate and succession); property and land (title checks, transfers, leases, boundary disputes); and employment law. If your matter is different, choose "Other" in the request form and the advocate will tell you whether the firm can help.'
        },
        sw: {
            q: 'Kampuni inashughulikia mashauri ya aina gani?',
            a: 'Kampuni inashughulikia migogoro na kesi za madai; masuala ya biashara na mikataba (kama usajili wa kampuni na mikataba ya wanahisa); sheria za familia (ndoa na talaka, malezi ya watoto, mirathi); ardhi na mali (uhakiki wa hati, uhamisho, upangaji, migogoro ya mipaka); na sheria za kazi. Kama shauri lako ni tofauti, chagua "Other" kwenye fomu ya ombi na wakili atakuambia kama kampuni inaweza kusaidia.'
        }
    },
    {
        id: 'fees',
        topics: ['cost', 'price', 'fee', 'fees', 'how much', 'charge', 'ada', 'bei', 'gharama', 'shilingi ngapi', 'kiasi gani'],
        en: {
            q: 'How much does it cost?',
            a: 'The fee depends on the matter. The firm sets the amount after reviewing your request or confirming your consultation, and it appears on your invoice in the portal before you pay anything. For an idea of the cost first, call or WhatsApp the firm on +255 714 840 951 or +255 657 259 584.'
        },
        sw: {
            q: 'Gharama ni kiasi gani?',
            a: 'Ada inategemea shauri. Kampuni inaweka kiasi baada ya kupitia ombi lako au kuthibitisha ushauri wako, na kinaonekana kwenye ankara yako ndani ya portal kabla hujalipa chochote. Kupata makadirio kwanza, piga simu au tuma WhatsApp kwa +255 714 840 951 au +255 657 259 584.'
        }
    },
    {
        id: 'password',
        topics: ['password', 'nywila', 'nenosiri', 'forgot', 'sahau', 'reset'],
        en: {
            q: 'I forgot my password. What do I do?',
            a: 'Call or WhatsApp the firm on +255 714 840 951 or +255 657 259 584 and give the email you registered with. The firm sets a temporary password and gives it to you directly. Sign in with it, then open Profile and choose your own under Change password. The portal does not send e-mails.'
        },
        sw: {
            q: 'Nimesahau nenosiri. Nifanye nini?',
            a: 'Piga simu au tuma WhatsApp kwa kampuni kupitia +255 714 840 951 au +255 657 259 584 na utaje email uliyojisajili nayo. Kampuni itakuwekea nenosiri la muda na kukupa moja kwa moja. Ingia nalo, kisha fungua Profile uweke lako mwenyewe kwenye Change password. Portal haitumi barua pepe.'
        }
    },
    {
        id: 'payment-rejected',
        topics: ['rejected', 'reject', 'imekataliwa', 'kataliwa', 'not accepted'],
        en: {
            q: 'My payment receipt was rejected. What now?',
            a: 'The reason is shown on your invoice in the portal. Check it (for example the amount or the transaction reference), then upload the correct receipt again from the same invoice. If you are unsure, call or WhatsApp the firm.'
        },
        sw: {
            q: 'Risiti yangu ya malipo imekataliwa. Nifanye nini?',
            a: 'Sababu inaonyeshwa kwenye ankara yako ndani ya portal. Iangalie (kwa mfano kiasi au namba ya muamala), kisha pakia risiti sahihi tena kwenye ankara hiyo hiyo. Ukiwa na shaka, piga simu au tuma WhatsApp kwa kampuni.'
        }
    }
];
export function findFaqById(id) {
    return SUPPORT_FAQ.find((f) => f.id === id) || null;
}
