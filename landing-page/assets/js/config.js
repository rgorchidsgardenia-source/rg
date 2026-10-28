/*
 * Landing page settings. Edit these values; no build step needed.
 */
window.RG_CONFIG = {
  // Where the lead API lives. Leave '' when the page is served by Vercel
  // (same origin). When the page is uploaded to rgstructures.in/landing-page
  // on GoDaddy, set this to the Vercel deployment, for example:
  //   apiBase: 'https://rg-orchids-gardenia.vercel.app'
  apiBase: '',

  // Where the videos are served from. Keep 'assets/video/' to serve them next
  // to the page, or point at a CDN / the Vercel deployment to keep heavy
  // files off shared hosting, e.g. 'https://rg-orchids-gardenia.vercel.app/landing-page/assets/video/'
  videoBase: 'assets/video/',

  // Headline numbers used everywhere on the page ([data-price], [data-size]).
  price: '₹2.99 Cr',
  size: '1,860 – 2,890 sq.ft',

  // Lead popup: first appears after firstDelay ms, then re-appears a random
  // 10-15 s after each close, until the visitor submits a form.
  popup: { firstDelay: 10000, repeatMin: 10000, repeatMax: 15000 },

  // Optional: send visitors to a thank-you page after a successful submit
  // (handy for Google Ads / Meta conversion tracking). '' = stay on page.
  thankYouUrl: ''
};
