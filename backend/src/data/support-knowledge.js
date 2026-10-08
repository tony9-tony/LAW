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
    faqSection: 'index.html#ai-faq'
};
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
        topics: ['firm', 'kampuni', 'about', 'kuhusu', 'who', 'nani', 'et cetra', 'machibya'],
        en: {
            q: 'Who is ET CETRA?',
            a: 'ET CETRA ADVOCATES COMPANY LIMITED is a technology-led advocates chambers led by Emmanuel Richard Machibya, Advocate & Legal Counsel, based in Posta, Kisutu, Tanzania. It handles corporate, property, dispute and private-client matters through a private client workspace.'
        },
        sw: {
            q: 'ET CETRA ni nani?',
            a: 'ET CETRA ADVOCATES COMPANY LIMITED ni chumba cha mawakili kinachoongozwa na teknolojia, kinachoongozwa na Emmanuel Richard Machibya, Wakili na Mshauri wa Kisheria, kilichopo Posta, Kisutu, Tanzania.'
        }
    },
    {
        id: 'how-it-works',
        topics: ['how', 'process', 'jinsi', 'hatua', 'work', 'start', 'begin', 'anzisha'],
        en: {
            q: 'How does it work?',
            a: 'Reach out through a confidential consultation or matter intake, the firm reviews your situation and advises on next steps, and if representation is needed it acts on your behalf. See the How It Works page for the full path.'
        },
        sw: {
            q: 'Inafanyaje kazi?',
            a: 'Wasiliana kupitia ushauri wa siri au fomu ya ombi, kampuni inapitia hali yako na kukushauri hatua zinazofuata, na ikihitajika uwakilishi inakutetea.'
        }
    },
    {
        id: 'consultation',
        topics: ['consultation', 'ushauri', 'appointment', 'miadi', 'book', 'weka', 'meeting'],
        en: {
            q: 'How do I book a consultation?',
            a: 'Choose Book Consultation to enter the existing consultation flow. You will sign in (or create an account), pick a consultation type and time, and submit. The firm then reviews it and you can track its status and payment from your portal.'
        },
        sw: {
            q: 'Nawezaje kuweka miadi ya ushauri?',
            a: 'Chagua Weka Miadi ya Ushauri ili kuingia kwenye mfumo wa miadi uliopo. Utaingia (au kufungua akaunti), kuchagua aina ya ushauri na muda, kisha kuwasilisha.'
        }
    },
    {
        id: 'request',
        topics: ['request', 'ombi', 'matter', 'shauri', 'submit', 'wasilisha', 'create', 'fungua', 'intake'],
        en: {
            q: 'How do I make a request?',
            a: 'Choose Make a Request to open the guided matter intake (5 steps). Describe your matter, review, and submit. The firm reviews it before any formal matter is opened. A request is not an accepted matter until any required payment is completed and approved by the firm.'
        },
        sw: {
            q: 'Nawezaje kuwasilisha ombi?',
            a: 'Chagua Wasilisha Ombi ili kufungua fomu ya ombi ya hatua 5. Eleza shauri lako, pitia, kisha wasilisha. Kampuni inapitia kabla ya kufungua shauri rasmi.'
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
        topics: ['account', 'akaunti', 'register', 'jisajili', 'sign', 'ingia', 'login', 'password', 'nywila'],
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
    }
];
export function findFaqById(id) {
    return SUPPORT_FAQ.find((f) => f.id === id) || null;
}
