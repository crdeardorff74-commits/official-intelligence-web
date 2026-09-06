/**
 * Google Ads conversion tag (gtag.js) for the umbrella site.
 *
 * The ad's landing page may be this site rather than the game, so the tag
 * has to exist on both — that is what the campaign diagnostic's "your
 * website is missing a Google tag" is checking. The CONVERSION itself is
 * only ever sent from the game (a solved puzzle; see
 * circuitousness-front-end/ads.js). This file loads the tag and nothing
 * else, so a click that lands here and walks over to the game still
 * attributes: one tag id across both, and gtag's default `auto` cookie
 * domain puts `_gcl_au` on the shared apex, so no cross-domain linker is
 * needed between official-intelligence.art and its subdomains.
 *
 * Conversion measurement only — no Google Analytics property, no
 * remarketing or audience list, and this site serves no ads.
 *
 * ⚠ THE ID IS DUPLICATED. The same value lives in the game's config.js
 * (`GOOGLE_ADS_ID`). The two are separate Netlify deploys with no shared
 * config, so there is no way to derive one from the other — change one,
 * change both, or the landing page and the conversion page report to
 * different properties and the campaign silently learns nothing.
 *
 * ⚠ NOT INCLUDED ON /admin/* OR /auth/* — those are the site owner's own
 * pages, they are not ad landing pages, and there is no reason to put a
 * third-party tag in front of an admin login.
 */
(function () {
    'use strict';

    // From Google Ads → Tag setup → "Install a Google tag in your website
    // code". While this is empty the file is a total no-op — no script
    // element, no cookie, no request — so it is safe to deploy before the
    // Ads account is configured.
    //
    // ⚠ Must stay identical to `GOOGLE_ADS_ID` in the game's config.js.
    // This file only LOADS the tag; the conversion itself is sent from
    // the game, so a mismatch means the landing page and the conversion
    // page report to different properties and neither number is right.
    var GOOGLE_ADS_ID = 'AW-17791773957';

    // Our own origin, over https, subdomain-anchored so
    // `official-intelligence.art.evil.com` cannot match. Also rules out
    // localhost, file://, and Netlify's deploy-preview hostnames.
    function isOwnOrigin() {
        if (location.protocol !== 'https:') return false;
        return /(^|\.)official-intelligence\.art$/i.test(location.hostname || '');
    }

    // No advertising cookie in the EEA / UK / Switzerland. This is what
    // lets the site carry a conversion tag with NO consent banner, and it
    // is the reason privacy.html can say plainly that the tag is not
    // loaded there: Google's EU user consent policy (and Consent Mode v2
    // behind it) applies to users in those countries, we do not target
    // ads there, so the cheapest correct answer is to never set the
    // cookie rather than to build a banner nobody benefits from.
    //
    // Timezone rather than language or IP: no network round trip, and not
    // defeated by a visitor who simply prefers French. It OVER-blocks
    // (Europe/Moscow and Europe/Istanbul are not EEA; a European
    // traveller in Ohio reads as Ohio) and over-blocking is the right
    // direction to err when the cost is untracked conversions in markets
    // the campaign does not buy. An unreadable timezone blocks too.
    //
    // ⚠ Keep this list identical to the game's ads.js. A visitor who is
    // excluded on one property and tagged on the other is the one case
    // the whole gate exists to prevent.
    var EEA_TZ_EXTRA = [
        'Atlantic/Azores', 'Atlantic/Madeira', 'Atlantic/Canary',
        'Atlantic/Faroe', 'Atlantic/Reykjavik', 'Atlantic/Jan_Mayen',
        'Arctic/Longyearbyen', 'Indian/Reunion', 'Indian/Mayotte',
        'America/Guadeloupe', 'America/Martinique', 'America/Cayenne',
        'America/Miquelon', 'America/Marigot', 'America/St_Barthelemy',
        'Pacific/Reunion'
    ];
    function isEEA() {
        var tz = null;
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
        if (!tz) return true;
        if (tz.indexOf('Europe/') === 0) return true;
        return EEA_TZ_EXTRA.indexOf(tz) !== -1;
    }

    if (!GOOGLE_ADS_ID || !isOwnOrigin() || isEEA()) return;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GOOGLE_ADS_ID, { allow_ad_personalization_signals: false });

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GOOGLE_ADS_ID);
    (document.head || document.documentElement).appendChild(s);
})();
