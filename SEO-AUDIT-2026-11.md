# CustomSongMe Search & AI Visibility Audit (Nov 3, 2026)

Scope: all 31 HTML pages in this repo (21 public pages, 10 private or utility pages). Covers Google search, plus how easy it is for ChatGPT, Perplexity and Google AI Overviews to understand and cite the site.
Branch: `seo-aeo-improvements` (not committed yet).

## Where the site already does well
- Every public page has a unique title, a meta description, a canonical URL and one H1.
- FAQ structured data on every sales page, and Article plus FAQ data on the four guides. AI answers use question-and-answer content like this a lot.
- Private and utility pages (thanks pages, payments, Oxnard, landscapers) are already kept out of Google.
- The English and Spanish homepages point to each other correctly (hreflang).
- robots.txt lets every search engine and AI crawler in.
- The guides (cost, gift ideas, song vs gift, anniversary tips) answer real buyer questions directly. These are the pages most likely to be cited in AI answers.

## Problems found and fixed
| # | Problem | Fix |
|---|---|---|
| 1 | The nav logo was a 673 KB, 1254px image, loaded on every page but shown at 44px | Added a 19 KB, 144px version (`img/customsongme-icon-144.png`) with width and height set |
| 2 | Dan's photo was 368 KB on 13 pages and had the wrong width/height ratio | Added a 56 KB version (`dan-the-song-man-512.jpg`), lazy-loaded, with the correct size |
| 3 | A private customer page (`/songs/rhonda-derek-a-street-apart`) could show up in Google | Added noindex, plus a `/songs/*` noindex header for every future customer page |
| 4 | The Get Well Song Cards page had no links pointing to it, and its Privacy link went to `/privacy`, which doesn't exist | Linked it from every occasion page and guide, fixed the link to `/privacy-terms`, added favicons |
| 5 | Holiday Songs was only linked from the homepage, during peak holiday season | Linked it from every occasion grid, footer and guide |
| 6 | The guide pages ended in a dead end ("Back to CustomSongMe") | Added a footer that links every occasion page and the other guides |
| 7 | Titles were thin ("Custom Pet Songs") or too long (the Holiday title was 81 characters) | Rewrote 13 titles to name the gift and the benefit (see below) |
| 8 | The homepage and Holiday meta descriptions were 190+ characters, so Google cuts them off | Shortened both to under 160 characters |
| 9 | Search engines and AI didn't clearly know who made the site or who Dan is | Added WebSite and Person (Dan Rock, "Dan the Song Man") data, and gave the business a logo, founder, area served (US) and languages (English, Spanish) |
| 10 | The price range in the structured data was $30–$75, but jingles are $100 | Changed it to $30–$100 |
| 11 | llms.txt listed only 13 pages and was missing the guides, holiday, get well and Spanish pages | Rewrote it with every public page, all prices, how ordering works, and the guarantee |
| 12 | The sitemap had no `lastmod` dates | Added dates, plus a comment pointing to llms.txt (robots.txt has the same pointer) |

### New titles
- Home: Personalized Custom Songs in 24 Hours, From $30
- Birthday: Custom Birthday Song Gift, Made in 24 Hours
- Anniversary: Custom Anniversary Song From Your Story
- Wedding: Custom Wedding Song for Your First Dance
- Love: Custom Love Song for Your Partner
- Mother's Day / Father's Day: Custom Mother's Day Song for Mom / Custom Father's Day Song for Dad
- Pet: Custom Pet Song for Your Dog or Cat
- Roast: Funny Custom Roast Song for Birthdays & More
- Memorial: Memorial & Celebration of Life Songs
- Jingles: Custom Business Jingle, $100 in 24 Hours
- Holiday: Custom Christmas & Thanksgiving Songs From $30 *(change this after the season)*
- Anniversary guide: What to Include in a Custom Anniversary Song

All of these end in "| CustomSongMe".

## Decisions made for you
1. **Removed the hidden star-rating code (4.9 stars, 16 reviews) from all 13 pages.** The 16 reviews are your Google Business reviews. Google's rules don't allow a site to mark up ratings collected on another site, and most pages show only 2 of the 16. Google also never shows stars for a business rating itself. So the code earned nothing and put you at risk of a Google penalty that strips all rich results. The review cards people see are unchanged, and your Google Business Profile stars still show in Maps and search.
2. **The Holiday title stays seasonal through Christmas.** After Dec 25, change it to "Custom Holiday Songs for Any Occasion | CustomSongMe".

## Things only you can do (biggest impact outside the code)
1. **Google Search Console:** submit `sitemap.xml`, then use URL Inspection to request indexing for the homepage, Holiday and the guides. Do the same in **Bing Webmaster Tools**. ChatGPT search and Copilot draw on Bing's index.
2. **Google Business Profile** (online-only "service-area business"): keep asking for reviews. Reviews feed both the map results and AI answers.
3. **Mentions on other sites.** AI tools cite pages that other sites talk about. Good targets: local news and community features (the Oxnard work, the free rescue dog songs), shelter partners linking to `/adopt-a-rescue-dog`, wedding and gift blogs, and Reddit/Quora answers where you honestly answer "how much does a custom song cost?" and link the guide.
4. **YouTube:** put the matching CustomSongMe page link (for example `/birthday-songs`) in the first line of every video description. YouTube is one of the sources Google AI Overviews cites most often.
5. **Check the social links** in the homepage structured data (facebook, instagram, tiktok and youtube `/customsongme`). Make sure each one is a real, active profile.

## Recommended next content (most likely to win AI answers)
- More guides that answer one question each: "Best custom song gift for a 50th anniversary", "How long does a custom song take?", "Custom song for a funeral: what to say", "Wedding first-dance song ideas" (link each to its occasion page).
- A short paragraph near the top of each occasion page that directly answers "What is a custom [birthday] song and how much does it cost?" in 2–3 sentences.
- VideoObject structured data for the "Press Play" homepage video and the sample songs (needs each video's upload date).

## Cleanup (optional)
About 22 MB of files aren't used by any page: `13183D9A-…png` (1.2 MB), `sample1–4.mp3`, `mothers-day-1–3.mp3` and `logo.webp`. Check whether you link them from somewhere else (social posts, emails) before deleting.

## Deliberately skipped
- **Markdown copies of every page:** the SEO plugin suggests them, but no major engine requires them, and keeping a second copy of every page in sync would be ongoing work for you. llms.txt covers the same need.
- **Ranking or citation tracking:** this needs Search Console access and repeated checks of AI answers over time. Easy to add once Search Console is connected.
