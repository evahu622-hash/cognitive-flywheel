# Design System — Cognitive Flywheel

> Notion-like minimalism. Typography-driven. Quiet confidence.
> The interface disappears; the thinking stays.

---

## Design Principles

1. **Content is king** — UI should be invisible. Every pixel of chrome that is not content is a tax on attention. Remove borders, reduce color, let text breathe.

2. **Calm over clever** — No gradients, no glow, no parallax. Interactions should feel like turning a page, not launching a rocket. The product is about deep thinking; the UI should match that mood.

3. **Progressive disclosure** — Show less by default, reveal on intent. Hover to see actions, click to expand, scroll to discover. Never overwhelm.

4. **Consistent rhythm** — Use a strict spacing scale. Every element should snap to the same invisible grid. Rhythm creates trust.

5. **One accent, maximum restraint** — The palette is almost entirely monochrome. A single warm accent color signals interactivity and the flywheel concept. Everything else is black, white, and gray.

---

## Color Tokens

All colors defined as CSS custom properties in `globals.css`. The palette is deliberately narrow.

### Light Mode

```css
:root {
  /* Surfaces */
  --bg-primary:       #FFFFFF;        /* main content background */
  --bg-secondary:     #F7F7F5;        /* sidebar, page shell, subtle sections */
  --bg-tertiary:      #F1F1EF;        /* hover states, active filters */
  --bg-elevated:      #FFFFFF;        /* cards, popovers (same as primary) */

  /* Text */
  --text-primary:     #37352F;        /* headings, body text */
  --text-secondary:   #787774;        /* descriptions, timestamps, labels */
  --text-tertiary:    #B4B4B0;        /* placeholders, disabled */
  --text-inverse:     #FFFFFF;        /* text on filled buttons */

  /* Borders */
  --border-default:   #E8E8E4;        /* card borders, dividers */
  --border-hover:     #D4D4D0;        /* border on hover */
  --border-focus:     #37352F;        /* input focus ring */

  /* Accent — warm amber/orange, used sparingly */
  --accent:           #D97706;        /* primary action, flywheel icon, active states */
  --accent-hover:     #B45309;        /* accent button hover */
  --accent-subtle:    #FEF3C7;        /* accent background tint */
  --accent-muted:     #F59E0B;        /* accent at lower emphasis */

  /* Semantic */
  --success:          #16A34A;
  --success-subtle:   #F0FDF4;
  --warning:          #CA8A04;
  --warning-subtle:   #FEFCE8;
  --error:            #DC2626;
  --error-subtle:     #FEF2F2;

  /* Think mode colors — muted versions, not saturated */
  --mode-roundtable:  #6B7280;        /* gray-500 — neutral authority */
  --mode-coach:       #6B7280;
  --mode-crossdomain: #6B7280;
  --mode-mirror:      #6B7280;
  /* In Notion style, modes are distinguished by icon + label, not color */
}
```

### Dark Mode

```css
.dark {
  --bg-primary:       #191919;
  --bg-secondary:     #202020;
  --bg-tertiary:      #2C2C2C;
  --bg-elevated:      #252525;

  --text-primary:     #E8E8E4;
  --text-secondary:   #9B9B97;
  --text-tertiary:    #5A5A58;
  --text-inverse:     #191919;

  --border-default:   #2E2E2E;
  --border-hover:     #3E3E3E;
  --border-focus:     #E8E8E4;

  --accent:           #F59E0B;
  --accent-hover:     #D97706;
  --accent-subtle:    #2C2416;
  --accent-muted:     #CA8A04;

  --success:          #22C55E;
  --success-subtle:   #14261A;
  --warning:          #EAB308;
  --warning-subtle:   #26220D;
  --error:            #EF4444;
  --error-subtle:     #2C1414;

  --mode-roundtable:  #9B9B97;
  --mode-coach:       #9B9B97;
  --mode-crossdomain: #9B9B97;
  --mode-mirror:      #9B9B97;
}
```

### Usage Rules

- **Never use raw color hex codes** in component files. Always reference tokens.
- Think mode cards use the **same neutral palette** but are distinguished by their icon and label, not background color. The current blue/green/purple/amber per-mode coloring should be replaced with monochrome cards + icon differentiation.
- The accent color (amber) should appear in at most **3 places per screen**: primary CTA, flywheel indicator, and one highlight element.

---

## Typography

Use **Inter** as the primary typeface (already available via Next.js `next/font`). Fall back to system sans-serif.

```
Font stack: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
```

### Type Scale

| Token             | Size    | Weight | Line Height | Usage                          |
|-------------------|---------|--------|-------------|--------------------------------|
| `heading-xl`      | 30px    | 700    | 1.2         | Page titles (Feed, Memory...)  |
| `heading-lg`      | 24px    | 600    | 1.3         | Section headers                |
| `heading-md`      | 18px    | 600    | 1.4         | Card titles, modal titles      |
| `heading-sm`      | 15px    | 600    | 1.4         | Sub-section labels             |
| `body`            | 14px    | 400    | 1.6         | Default body text              |
| `body-sm`         | 13px    | 400    | 1.5         | Descriptions, secondary info   |
| `caption`         | 12px    | 400    | 1.4         | Timestamps, badges, metadata   |
| `overline`        | 11px    | 500    | 1.3         | Category labels (uppercase)    |

### Rules

- **Hierarchy through weight and size only.** Do not use color to create hierarchy (e.g., no blue headings). Use `text-primary` for headings, `text-secondary` for descriptions.
- **No bold body text** unless it is a key point or link. Overuse of bold flattens hierarchy.
- Page titles: `heading-xl`, no icon prefix. The icon (if any) goes above the title as a small, muted element, not inline.
- Subtitle/description: `body-sm` in `text-secondary`, always one line below the title with 4px gap.

---

## Spacing System

Use a **4px base unit**. All spacing should be a multiple of 4.

| Token   | Value | Usage                                          |
|---------|-------|-------------------------------------------------|
| `sp-1`  | 4px   | Inline gaps (icon-to-text)                     |
| `sp-2`  | 8px   | Badge padding, tight element groups             |
| `sp-3`  | 12px  | Input padding, small card padding               |
| `sp-4`  | 16px  | Default card padding, element spacing            |
| `sp-5`  | 20px  | Section gap within a page                       |
| `sp-6`  | 24px  | Between major sections                          |
| `sp-8`  | 32px  | Page-level top/bottom padding                   |
| `sp-10` | 40px  | Large section breaks                            |
| `sp-12` | 48px  | Page header to first content block              |

### Layout Constants

| Property               | Value      | Notes                                     |
|------------------------|------------|-------------------------------------------|
| Content max-width      | 720px      | Single-column pages (Feed, Think)         |
| Wide max-width         | 960px      | Grid pages (Memory, Me)                   |
| Sidebar width          | 240px      | Fixed, collapsible                        |
| Page horizontal padding| 24px       | Minimum on mobile                         |
| Card padding           | 20px       | All sides                                 |
| Card gap (stacked)     | 12px       | Between cards in a list                   |

---

## Border & Radius

| Token             | Value  | Usage                            |
|-------------------|--------|----------------------------------|
| `radius-sm`       | 4px    | Badges, small chips              |
| `radius-md`       | 6px    | Buttons, inputs                  |
| `radius-lg`       | 8px    | Cards, dialogs                   |
| `radius-xl`       | 12px   | Large containers, hero cards     |
| Border width      | 1px    | Always 1px. Never 2px.          |
| Border color      | `--border-default` | Barely visible, structural only  |

### Rules

- Cards have a **1px border** in `--border-default`. No box-shadow by default.
- On hover, cards may gain a very subtle shadow: `0 1px 3px rgba(0,0,0,0.04)`.
- **Never use colored borders** for cards (remove the current green/blue/purple/amber card borders). Use a subtle left-edge accent bar (2px, `--accent`) if distinction is needed.
- Focus rings: 2px solid `--border-focus`, 2px offset.

---

## Component Patterns

### Cards

The primary container for all content blocks. Notion-style: minimal, borderless feel.

```
Default card:
- Background:   --bg-primary (light) / --bg-elevated (dark)
- Border:       1px solid --border-default
- Radius:       radius-lg (8px)
- Padding:      20px
- Shadow:       none
- Hover:        border-color --border-hover, shadow 0 1px 3px rgba(0,0,0,0.04)

Stat card (Memory, Me pages):
- Same as default, but text-center layout
- Number:       heading-xl, font-weight 700, text-primary
- Label:        caption, text-secondary
- No icon coloring — use text-secondary for icons
```

### Buttons

```
Primary (filled):
- Background:   --text-primary (#37352F light / #E8E8E4 dark)
- Text:         --text-inverse
- Radius:       radius-md (6px)
- Padding:      8px 14px
- Font:         body-sm, weight 500
- Hover:        opacity 0.85
- No shadow, no gradient

Secondary (outline):
- Background:   transparent
- Border:       1px solid --border-default
- Text:         --text-primary
- Hover:        background --bg-tertiary

Ghost:
- Background:   transparent
- Border:       none
- Text:         --text-secondary
- Hover:        background --bg-tertiary

Accent (sparingly — only for primary CTA on landing):
- Background:   --accent
- Text:         white
- Hover:        --accent-hover
```

### Badges / Tags

```
Default badge:
- Background:   --bg-tertiary
- Text:         --text-secondary
- Font:         caption (12px), weight 400
- Padding:      2px 8px
- Radius:       radius-sm (4px)
- Border:       none (unlike current outline badges)
- No colored backgrounds per domain. All badges are monochrome.

Active/selected filter badge:
- Background:   --text-primary
- Text:         --text-inverse
```

### Inputs

```
Text input / Textarea:
- Background:   --bg-primary
- Border:       1px solid --border-default
- Radius:       radius-md (6px)
- Padding:      8px 12px
- Font:         body (14px)
- Placeholder:  --text-tertiary
- Focus:        border-color --border-focus, no glow/ring
- Hover:        border-color --border-hover
```

### Search Input

```
- Left icon (Search) in --text-tertiary
- No visible border by default — use bg-secondary as background
- On focus: white background, 1px border --border-focus
- Notion style: the search bar feels embedded, not floating
```

### Empty States

```
- Dashed border:  1px dashed --border-default
- Radius:         radius-lg
- Padding:        48px vertical
- Text:           body, --text-tertiary, centered
- No emoji in empty state text
- Optional:       a small muted icon above the text
```

---

## Icons

- Library: **lucide-react** (already in use)
- Stroke width: 1.5px (lucide default) — do not override
- Default size: 16px (h-4 w-4) for inline, 20px (h-5 w-5) for standalone
- Color: always `--text-secondary`. Never use colored icons in body content.
- Exception: the flywheel/brain icon on the landing page may use `--accent`

### Page Title Icons

Current pattern (icon inline with title text) should be replaced:

```
Before:  <Database className="h-8 w-8" /> Memory
After:   Memory                            (icon removed from title)
         记忆宫殿                           (Chinese subtitle below)
```

Page titles should be text-only. The page's identity is conveyed by the sidebar navigation icon, not duplicated in the header.

---

## Sidebar

Notion-style sidebar:

```
- Background:    --bg-secondary
- Width:         240px
- Border-right:  1px solid --border-default
- Item padding:  6px 12px
- Item radius:   radius-md (6px)
- Item font:     body-sm (13px), weight 400
- Item icon:     16px, --text-secondary
- Active item:   background --bg-tertiary, text --text-primary, font-weight 500
- Hover item:    background --bg-tertiary
- No colored icons in sidebar items
```

---

## Page-Specific Design Notes

### Landing Page (`/`)

- Centered layout, generous vertical spacing (sp-12 between sections)
- The brain icon: replace the rounded square container with a simple, larger icon in `--accent`, no background shape
- Title: `heading-xl` at 36px for the landing only
- Subtitle: `body` in `--text-secondary`
- CTA buttons: one primary (filled), one secondary (outline). No more than 2.
- The 4 capability labels at the bottom: render as a 4-column text row in `--text-tertiary`, no emoji. Use the lucide icons instead, at 16px, muted.
- Overall feel: a calm, confident title page. Like opening Notion for the first time.

### Feed Page (`/feed`)

- **Two input modes** (URL and text) should be presented as **tabs**, not two separate cards. Reduces visual weight.
- Tab style: Notion-style underline tabs (text with a 2px bottom border on active tab, no background).
- Input area: single card, generous padding, clean textarea.
- The "Digest" button: right-aligned, primary style, no icon prefix.
- **Digest results**: render like Notion database rows:
  - Left: type indicator (small dot or line-style icon, muted)
  - Title: `heading-sm`, one line
  - Below title: tags as muted badges, inline
  - Key points: revealed on click/expand, not shown by default
  - No colored card borders. No green checkmark. No amber "connection" highlight box.
  - Connections shown as a subtle indented line below, preceded by a small link icon.

### Memory Page (`/memory`)

- **Knowledge items as a Notion table/list view:**
  - Each item is a single row: icon | title | domain | tags | date
  - No card wrapper per item. Use a borderless list with subtle dividers (1px `--border-default`).
  - On hover: full row gets `--bg-tertiary` background
  - Click to expand inline (accordion style), revealing summary + connections
- **Stats row**: 3 numbers in a horizontal bar at the top, not 3 separate cards. Lighter weight.
- **Domain filters**: pill-style buttons, monochrome. Active = filled black, inactive = ghost.
- **Search**: full-width, Notion-style embedded search (bg-secondary, no border).

### Think Page (`/think`)

- **Mode selection**: 2x2 grid of cards, but much simpler:
  - Each card: icon (20px, `--text-secondary`) + title (`heading-sm`) + one-line description (`body-sm`, `--text-secondary`)
  - No colored icon backgrounds. No colored text.
  - Hover: border shifts to `--border-hover`, very subtle shadow
  - The mode's identity comes from its icon and title text, not color.
- **Active thinking view**:
  - Back button: ghost style, `--text-secondary`
  - Input card: clean, single textarea + right-aligned button
  - Thinking indicator: simple text with a subtle animated ellipsis (not a spinner card). Just: `"Thinking..."` in `--text-secondary` with a pulsing dot.
  - Results: clean cards with no colored borders. Expert names use `heading-sm`, their role in `caption`.
  - InsightBox (flywheel feedback): a single borderless section at the bottom with a subtle `--accent` left bar (2px), containing the insights as a bulleted list. No gradient background.

### Me Page (`/me`)

- **Flywheel hero**: simplify the gradient card. Use a clean card with:
  - Left: "Flywheel" label + the cycle text in `caption`
  - Right: large number in `heading-xl`, `--accent` color
  - No gradient, no background tint
- **Stats**: inline with the hero or as a compact horizontal row (not 3 separate cards)
- **Domain distribution**: horizontal bar chart, bars in `--text-tertiary` with the active/dominant bar in `--accent`
- **Growth chart**: keep the bar chart but use `--text-tertiary` for bars, `--accent` for today's bar
- **Blind spots**: plain list items with a subtle warning icon (lucide `AlertTriangle`, 14px, `--text-secondary`). No emoji, no amber background.
- **Achievements**: simple list, no emoji. Use a small dot or dash as the list marker.

---

## Animation & Interaction Guidelines

### Transitions

```
Default transition:  150ms ease
Hover transitions:   background-color 150ms, border-color 150ms, box-shadow 200ms
Expand/collapse:     height 200ms ease, opacity 150ms ease
Page transitions:    none (instant — Notion does not animate page changes)
```

### Hover Behavior

- **Cards**: border darkens slightly, optional micro-shadow appears
- **List rows**: background shifts to `--bg-tertiary`
- **Buttons**: primary buttons reduce opacity; ghost buttons gain background
- **Actions**: secondary actions (delete, edit, bookmark) are **hidden by default**, revealed on row/card hover. Use `opacity-0 group-hover:opacity-100 transition-opacity` pattern.

### Loading States

- **No spinners** in the center of the page. Use a thin progress bar at the top of the content area, or inline text with an animated ellipsis.
- Skeleton loaders for content that takes >300ms: use `--bg-tertiary` rectangles with a subtle shimmer animation.
- The current `Loader2 animate-spin` pattern should be replaced with a more Notion-like indicator.

### The Flywheel Metaphor

The flywheel is the core concept but should be expressed **subtly**:

- A small circular arrow icon (lucide `RefreshCw` or custom) in `--accent` appears in the sidebar footer showing "flywheel turns: N".
- When a thinking result is saved back to memory, show a brief, understated toast: "Flywheel +1" with the circular arrow icon. Duration: 2 seconds, bottom-right, no sound.
- On the Me page, the flywheel count is the most prominent number — large, in `--accent`.
- Do **not** animate a spinning flywheel graphic. The metaphor is conceptual, not literal.

---

## Mapping to Tailwind / shadcn/ui

The design tokens above should be mapped to the existing shadcn/ui CSS variable system in `globals.css`. Key mappings:

| Design Token       | shadcn Variable          | Notes                              |
|---------------------|--------------------------|------------------------------------|
| `--bg-primary`      | `--background`           | Page background                    |
| `--bg-secondary`    | `--sidebar`, `--muted`   | Sidebar, secondary surfaces        |
| `--bg-tertiary`     | `--accent`               | Hover states (shadcn "accent")     |
| `--text-primary`    | `--foreground`           | Main text                          |
| `--text-secondary`  | `--muted-foreground`     | Secondary text                     |
| `--border-default`  | `--border`               | All borders                        |
| `--accent`          | `--primary`              | In Notion style, primary = accent  |
| `--bg-elevated`     | `--card`                 | Card backgrounds                   |

When implementing, update the oklch values in `globals.css` to match the hex values defined above. Use an oklch converter to maintain the existing format.

---

## Implementation Priority

When refactoring the existing UI to match this design system:

1. **Colors first** — Update `globals.css` with the Notion-inspired palette. This alone will transform the feel.
2. **Remove colored card borders** — Replace all `border-blue-*`, `border-green-*`, etc. with default borders.
3. **Simplify Think mode cards** — Remove per-mode color coding. Use monochrome + icon differentiation.
4. **Typography cleanup** — Ensure consistent heading sizes, remove inline icons from page titles.
5. **Feed results** — Restyle as database-row entries instead of decorated cards.
6. **Memory list** — Convert from card-per-item to borderless list rows.
7. **Animations** — Replace spinners with subtle indicators. Add hover-reveal for actions.
8. **Dark mode** — Verify all token values work in dark mode after palette changes.

---

## Reference

Visual references for the target aesthetic:

- **Notion** — The primary reference. Clean, warm, typography-first.
- **Linear** — For interaction patterns (hover-reveal, keyboard shortcuts feel).
- **Bear (app)** — For the warmth in a writing/thinking tool.
- **iA Writer** — For typographic confidence and restraint.

The goal is not to clone Notion, but to capture its **feeling**: that the tool respects your attention and gets out of the way of your thinking.
