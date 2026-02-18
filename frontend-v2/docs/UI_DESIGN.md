# UI Design Guidelines

This document defines the visual design language and guidelines for the Forecast-in-a-Box frontend application.

## Typography

### Font Family

- **Primary Font**: Source Sans 3 Variable
- **Monospace Font**: System monospace stack for code/technical values

### Font Size Scale

The application uses Tailwind CSS font size classes. **14px (text-sm) is the minimum font size for all readable content.**

| Class       | Size  | Usage                                                                                  |
| ----------- | ----- | -------------------------------------------------------------------------------------- |
| `text-xs`   | 12px  | **Avoid** - Only for exceptional cases where space is extremely constrained            |
| `text-sm`   | 14px  | **Minimum** - Labels, descriptions, timestamps, metadata, badges, tags, secondary text |
| `text-base` | 16px  | Primary body text, paragraphs                                                          |
| `text-lg`   | 18px  | Card titles, section headers                                                           |
| `text-xl`   | 20px  | Page section titles                                                                    |
| `text-2xl`  | 24px  | Page titles                                                                            |
| `text-3xl+` | 30px+ | Hero text, landing page headings                                                       |

### Font Size Guidelines

1. **All user-facing content must be at least 14px (text-sm)**
   - Labels (e.g., "Downloaded models", "Active forecasts")
   - Descriptions and help text
   - Timestamps (e.g., "Released 2 days ago", "Posted by John")
   - Metadata (e.g., model names, job details)
   - Badges and tags
   - Action links and buttons
   - Form field labels
   - Error messages

2. **Use text-base (16px) for**
   - Primary content paragraphs
   - Main descriptive text
   - Dialog/modal body text

3. **Avoid text-xs (12px)**
   - Do not use for any readable content
   - Only acceptable for decorative or non-essential UI elements

### Examples

```tsx
// ✅ Good - All readable content at 14px+
<span className="text-sm text-muted-foreground">Released 2 days ago</span>
<Badge className="text-sm">Scheduled</Badge>
<p className="text-sm">Configuration description here</p>

// ❌ Bad - Content too small to read comfortably
<span className="text-xs text-muted-foreground">Released 2 days ago</span>
<Badge className="text-xs">Scheduled</Badge>
```

## Typography Components

The application provides a set of semantic typography components in `@/components/base/typography.tsx`. **Always prefer these components over raw HTML elements** for consistent styling across the application.

### Available Components

| Component    | HTML Element            | Default Styles                                    |
| ------------ | ----------------------- | ------------------------------------------------- |
| `H1`         | `<h1>`                  | 4xl/5xl, font-semibold, tracking-tight            |
| `H2`         | `<h2>`                  | 3xl, font-semibold, tracking-tight, border-bottom |
| `H3`         | `<h3>`                  | 2xl, font-semibold, tracking-tight                |
| `P`          | `<p>`                   | leading-7, margin-top on non-first                |
| `Blockquote` | `<blockquote>`          | border-left, italic                               |
| `List`       | `<ul>`                  | list-disc, margin, spacing                        |
| `Link`       | `<a>` / TanStack `Link` | Underline, primary color, auto external handling  |
| `Typography` | Configurable            | Generic component with variant prop               |

### Typography Variants

The `Typography` component accepts a `variant` prop for flexible styling with any HTML element:

```tsx
import { Typography } from '@/components/base/typography'

// Variants available:
// h1, h2, h3, h4, p, blockquote, list, lead, large, small, muted
<Typography variant="lead" as="p">Large introductory text</Typography>
<Typography variant="muted" as="span">Secondary text</Typography>
```

### Link Component

The `Link` component automatically handles internal vs external links:

```tsx
import { Link } from '@/components/base/typography'

// Internal link (uses TanStack Router)
<Link to="/dashboard">Dashboard</Link>

// External link (auto-detected from http/https, opens in new tab)
<Link href="https://ecmwf.int">ECMWF</Link>

// Link variants
<Link underline={false} color="muted" href="...">Subtle link</Link>
```

### Usage Guidelines

1. **Use semantic components for all text content**

   ```tsx
   // ✅ Good
   import { H1, H2, P, Link } from '@/components/base/typography'

   <H1>Page Title</H1>
   <P>Content paragraph with <Link href="...">a link</Link>.</P>

   // ❌ Avoid raw HTML elements for main content
   <h1 className="...">Page Title</h1>
   <p className="...">Content...</p>
   ```

2. **Override styles with className when needed**

   ```tsx
   // Custom styling while maintaining base variants
   <H2 className="border-0 pb-0 text-4xl">Custom Heading</H2>
   <P className="text-balance max-w-xl">Centered paragraph</P>
   ```

3. **Use Typography component for non-standard elements**

   ```tsx
   // Apply heading styles to a span
   <Typography variant="h3" as="span">Inline heading style</Typography>

   // Apply lead styles to a paragraph
   <Typography variant="lead" as="p">Introductory text</Typography>
   ```

4. **Landing pages and marketing content**

   ```tsx
   // Hero sections
   <H1 className="text-5xl md:text-6xl lg:text-7xl">Hero Title</H1>
   <Typography variant="lead" as="p" className="lg:text-xl">
     Supporting description text
   </Typography>

   // Section headings
   <H2 className="border-0 text-4xl">Section Title</H2>
   <P className="mt-4">Section description</P>
   ```

## Color System

Colors are defined in `src/styles.css` using CSS custom properties with the OKLCH color space.

### Semantic Colors (Available)

| Purpose           | Light Mode              | Dark Mode          |
| ----------------- | ----------------------- | ------------------ |
| Primary           | `text-primary`          | Auto-adapts        |
| Muted/Secondary   | `text-muted-foreground` | Auto-adapts        |
| Success           | `text-emerald-600`      | `text-emerald-400` |
| Warning           | `text-amber-600`        | `text-amber-400`   |
| Error/Destructive | `text-red-600`          | `text-red-400`     |
| Info              | `text-blue-600`         | `text-blue-400`    |

### Background Colors

- `bg-background` - Page background
- `bg-card` - Card/panel backgrounds
- `bg-muted` - Subtle backgrounds, tags
- `bg-muted/50` - Very subtle backgrounds

## Spacing

Use Tailwind's spacing scale consistently:

| Class   | Size | Usage                   |
| ------- | ---- | ----------------------- |
| `gap-1` | 4px  | Tight inline spacing    |
| `gap-2` | 8px  | Standard inline spacing |
| `gap-3` | 12px | Medium spacing          |
| `gap-4` | 16px | Section spacing         |
| `gap-6` | 24px | Large section spacing   |
| `gap-8` | 32px | Major section breaks    |

### Padding Guidelines

- **Cards**: `p-4` to `p-6`
- **Buttons**: `px-3 py-1.5` (small), `px-4 py-2` (default)
- **Badges**: `px-2 py-0.5` to `px-2.5 py-1`
- **Form inputs**: `px-3 py-2`

## Components

### Badges

```tsx
// Standard badge
<Badge variant="outline" className="text-sm">Label</Badge>

// Error badge
<Badge variant="destructive" className="text-sm gap-1">
  <AlertCircle className="h-3 w-3" />
  Error
</Badge>

// Status badge with color
<Badge className="bg-emerald-100 text-emerald-700 text-sm">Active</Badge>
```

### Cards

```tsx
<Card className="p-6">
  <h2 className="mb-4 text-lg font-semibold">Card Title</h2>
  <p className="text-sm text-muted-foreground">Card content...</p>
</Card>
```

### Form Fields

```tsx
<div className="space-y-1.5">
  <Label htmlFor="field" className="text-sm">
    Field Label
  </Label>
  <p className="text-sm text-muted-foreground">Help text here</p>
  <Input id="field" className="h-9" />
</div>
```

### Action Links

```tsx
<a className="text-sm font-medium text-primary hover:underline">View Details</a>
```

## Icons

- Use Lucide React icons consistently
- Standard sizes:
  - Inline with text: `h-4 w-4`
  - Button icons: `h-4 w-4` to `h-5 w-5`
  - Feature icons: `h-6 w-6` to `h-8 w-8`
  - Hero icons: `h-10 w-10` or larger

## Responsive Design

### Breakpoints

| Breakpoint | Prefix | Width   | Typical Devices             |
| ---------- | ------ | ------- | --------------------------- |
| Mobile     | -      | < 640px | Phones                      |
| Tablet     | `sm:`  | 640px+  | Small tablets, large phones |
| Desktop    | `lg:`  | 1024px+ | Laptops, desktops           |
| Large      | `xl:`  | 1280px+ | Large monitors              |

### Core Guidelines

1. **Desktop-first approach** - Primary design target is desktop
2. **Mobile must work** - All features accessible on mobile
3. **Touch targets** - Minimum 44x44px for interactive elements on mobile
4. **Responsive text** - Use responsive prefixes when needed: `text-sm lg:text-base`

### Detecting Viewport with JavaScript

Use the `useMedia` hook for JavaScript-level responsive logic:

```tsx
import { useMedia } from '@/hooks/useMedia'

function MyComponent() {
  const isMobile = useMedia('(max-width: 639px)') // Below sm breakpoint
  const isTablet = useMedia('(max-width: 1023px)') // Below lg breakpoint

  // Use for conditional rendering or behavior
  if (isMobile) {
    return <MobileView />
  }
  return <DesktopView />
}
```

### Table/Card View Pattern for Admin Pages

Admin and management pages (e.g., Plugins, Sources) often support both table and card views. Follow these patterns:

#### View Mode Behavior by Viewport

| Viewport          | View Toggle | Rendered View               |
| ----------------- | ----------- | --------------------------- |
| Mobile (< 640px)  | Hidden      | Card only (forced)          |
| Tablet (640px+)   | Visible     | User choice (table or card) |
| Desktop (1024px+) | Visible     | User choice (table or card) |

#### Implementation Pattern

```tsx
// In list component (e.g., PluginsList.tsx)
import { useMedia } from '@/hooks/useMedia'

function MyList({ viewMode, ... }) {
  // Force card view on mobile
  const isMobile = useMedia('(max-width: 639px)')
  const effectiveViewMode = isMobile ? 'card' : viewMode

  if (effectiveViewMode === 'card') {
    return <CardView />
  }
  return <TableView />
}
```

```tsx
// In filters component (e.g., PluginsFilters.tsx)
// Hide view toggle on mobile with `hidden sm:flex`
<div className="hidden items-center rounded-md border sm:flex">
  <Button onClick={() => setViewMode('table')}>
    <List className="h-4 w-4" />
  </Button>
  <Button onClick={() => setViewMode('card')}>
    <LayoutGrid className="h-4 w-4" />
  </Button>
</div>
```

#### Why Force Card View on Mobile?

- Table columns become too compressed and unreadable
- Horizontal scrolling creates poor UX
- Cards stack naturally in single column
- Touch targets remain accessible

### Filter Layout Patterns

Filters should adapt gracefully across viewports:

```tsx
// Allow wrapping on tablet and smaller, single row on desktop
<div className="flex flex-wrap gap-3 lg:flex-nowrap">
  <Input className="w-full sm:w-auto lg:w-64" />
  <Select className="w-[140px]" />
  {/* View toggle - hidden on mobile */}
  <div className="hidden sm:flex">...</div>
</div>
```

#### Key Classes for Responsive Filters

| Pattern                    | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `flex-wrap lg:flex-nowrap` | Wrap on mobile/tablet, single row on desktop  |
| `w-full sm:w-auto lg:w-64` | Full width mobile, auto tablet, fixed desktop |
| `hidden sm:flex`           | Hide on mobile, show on tablet+               |
| `flex-col lg:flex-row`     | Stack on mobile/tablet, row on desktop        |

### Card Grid Patterns

Cards should display in responsive grids:

```tsx
// Standard responsive grid
<div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
  {items.map((item) => (
    <Card key={item.id} />
  ))}
</div>
```

| Viewport | Columns | Notes            |
| -------- | ------- | ---------------- |
| Mobile   | 1       | Full-width cards |
| Tablet   | 2       | Side-by-side     |
| Desktop  | 3       | Optimal density  |

### Table Responsive Patterns

For tables that must display on smaller screens (tablet+):

```tsx
// Header row - hidden on mobile
<div className="hidden sm:grid sm:grid-cols-12 ...">
  <div className="sm:col-span-4">Name</div>
  <div className="sm:col-span-2">Status</div>
  ...
</div>

// Row - adapts layout
<div className="grid grid-cols-1 sm:grid-cols-12 ...">
  <div className="sm:col-span-4">...</div>
  ...
</div>
```

## Dark Mode

- All components must support both light and dark modes
- Use semantic color classes that auto-adapt: `text-foreground`, `bg-background`
- For custom colors, provide both variants: `text-emerald-600 dark:text-emerald-400`

## Accessibility

- **Color contrast**: WCAG AA minimum (4.5:1 for normal text, 3:1 for large text)
- **Focus states**: All interactive elements must have visible focus indicators
- **ARIA labels**: Provide for icon-only buttons and non-text content
- **Keyboard navigation**: All functionality accessible via keyboard

## Component Library

UI components are sourced from shadcn/ui with the Base-UI style preset. Add new components using:

```bash
npx shadcn@latest add [component-name]
```

Components are installed to `@/components/ui/` and can be customized as needed.
