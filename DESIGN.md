# BAC Logistics — Design Reference

The established visual design system for baclogistics.co.za, as it actually exists in
`site/inc/css/main.css` (single stylesheet, no build step, no framework). Read this before
any visual/UI change, new page template, or new content-block type, so new work reuses what's
already here instead of drifting from it.

Blog page templates live in `api/src/blog-templates/` — tokenized copies of the
static markup, rendered server-side by the Function. Edit them there, not in `site/`.

## Design tokens

All in `main.css`'s `:root`:

| Token | Value | Use |
|---|---|---|
| `--brand-blue` | `#000000` | primary text/heading color |
| `--accent` (= `--brand-turquoise`) | `#e2202a` | red — links, buttons, active states, counters. Both variables hold the same red; `--brand-turquoise` is a naming leftover from the original agency template, not a second color. Prefer `--accent` in new work. |
| `--brand-dark` | `#6d6f70` | muted gray — header-top bar, secondary text |
| `--brand-light` / `--surface-muted` | `#ddd` | light gray surfaces |
| `--accent-soft` | `#fff3e8` | soft warm background tint |
| `--surface` | `#fff` | card/panel backgrounds |
| `--border` | `#d8dde8` | card/input borders |
| `--text` / `--text-muted` | `#000000` / `#6d6f70` | body text / secondary text |
| `--shadow` | `0 20px 40px rgb(15 23 42 / 10%)` | the one shadow used on every card/panel |
| `--radius` | `18px` | base corner radius (cards typically 18–28px) |
| `--container-width` | `1200px` | max content width (`.container`) |

Typography: **Roboto** (body and headings). `h1` and `h2` use `clamp()` for fluid sizing
(`h1: clamp(2rem, 3vw, 3rem)`, `h2: clamp(1.6rem, 2.4vw, 2.3rem)`). Body copy: `line-height: 1.65`.

## Breakpoints

Four, all in `main.css`, all `max-width`-style (`width <= Npx`) except the nav one:

| Breakpoint | What changes |
|---|---|
| `min-width: 1101px` | Desktop nav shown, mobile hamburger (`.gl-hide-on-desktop`) hidden. Below 1100px is "mobile/tablet" mode. |
| `900px` | Cart/checkout/product/footer grids collapse to 1 column; header rows stack; team/features/counters grids go 3→2 columns. |
| `700px` | Container inset tightens (60px → 32px); remaining multi-column grids (newsletter, contact form, team/features/counters) go to 1 column. |
| `470px` | Buttons go full-width; hero/slider aspect ratio changes (16:7); mobile-only elements (`.gl-hide-on-mobile`) hide. |

New responsive behavior should hook into these four breakpoints rather than introduce new ones.

## Component patterns

Reuse these before writing new CSS — check `main.css` for the exact class first.

- **Buttons** — `.btn-1` (outline), `.btn-2` (filled, primary), `.btn-white` (white, for dark
  backgrounds). All share: pill shape (`border-radius: 999px`), `min-height: 48px`, hover =
  lift + shadow.
- **Cards** — one visual pattern reused everywhere: `border` + rounded corners (18–28px) +
  translucent white background (`rgb(255 255 255 / 92–96%)`) + `var(--shadow)`, hover =
  `translateY(-2px to -4px)` + bigger shadow. Used by service cards, blog cards, video cards,
  team cards, feature cards, counter cards, FAQ items, product cards.
- **Header/footer** — `#gl-header-top` (dark utility bar: quote/phone/WhatsApp buttons + social
  icons), `#gl-header-bottom` (sticky, blurred backdrop, logo + nav, hover dropdowns on
  desktop). Mobile nav is a separate toggle: `#mobile-nav-trigger` / `#header-mobile-nav`,
  JS-driven (see below), not a breakpoint-only CSS switch.
- **Forms** — contact/service/newsletter forms share one input style: `padding: 12–14px`,
  `border: 1px solid var(--border)`, `border-radius: 12–14px`. Multi-column on desktop,
  collapses to 1 column at the 700px breakpoint.
- **FAQ accordion** — `.faq-question` button toggles `aria-expanded` + a sibling
  `.faq-answer[hidden]`.
- **Content blocks** — reusable section types driven by data-attributes rather than modifier
  classes: `.gl-image-and-text` (`data-image-position: left/right/above/below`),
  `.gl-video-and-text` (`data-video-position`), `.gl-cta` / `.gl-text-section` / `.gl-our-team`
  / `.gl-features` (`data-title-align: left/center/right`). Prefer extending one of these over
  building a new section type.
- **Hero** — `#gl-slider` (Slick carousel, homepage only, loads from `cdn.jsdelivr.net`,
  degrades gracefully if that CDN is unreachable) vs. `#gl-hero-image` (static hero, every other
  page). Both use `aspect-ratio: 1920/500` + `object-fit: cover`.
- **Card thumbnails** — always `aspect-ratio` + `object-fit: cover`, never a fixed-height crop.

## Conventions

- **Root-relative paths only** for internal links and assets (`/about/`, `/inc/css/main.css`,
  not absolute URLs). The only exception is canonical/alternate `<link>` tags, `og:`/`twitter:`
  meta tags, and JSON-LD — those stay absolute to `baclogistics.co.za` by design.
  Never hand-write a new absolute internal link.
- **Reuse before inventing** — a new page or section almost certainly matches one of the
  patterns above; check `main.css` before adding a new class.
- **Content tone** — professional B2B logistics/freight-forwarding voice; match the existing
  service pages and blog posts rather than introducing a new style.

## Where things live

- `site/inc/css/main.css` — the entire stylesheet (no build step, no preprocessor).
- `site/inc/js/main.js` — mobile nav toggle, FAQ accordion, Slick slider init (homepage only),
  scroll-triggered counters, active-nav-link marking, contact-form timestamp stamping.
- The `gl-`/`glh-` class prefix is the original agency template's name ("Gridlink"), kept for
  continuity — not a rename target.
