# Greenfinch Design Guidelines

## Brand Identity
Greenfinch is a commercial property prospecting platform that helps sales teams find decision-makers. The design should feel professional, modern, and trustworthy.

## Color Palette

### Primary Colors
- **Primary Green**: `#16a34a` (green-600) - Main brand color for CTAs and accents
- **Emerald**: `#059669` (emerald-600) - Secondary green for gradients
- **Gold/Yellow**: `#eab308` (yellow-500) - Accent color for highlights

### Neutral Colors
- **Background**: `#ffffff` to `#f0fdf4` (white to green-50) - Subtle green tint
- **Text Primary**: `#111827` (gray-900)
- **Text Secondary**: `#4b5563` (gray-600)
- **Text Tertiary**: `#9ca3af` (gray-400)
- **Borders**: `#e5e7eb` (gray-200)

### Gradient Usage
- Hero backgrounds: `from-green-50 via-white to-emerald-50`
- CTA buttons: `from-green-500 to-emerald-600`
- Logo/branding: `from-green-500 to-emerald-600`

## Typography

### Font Families
- **Headings**: Inter or system font with `font-serif` for hero headings
- **Body**: Inter or system sans-serif

### Font Sizes
- Hero H1: `text-5xl sm:text-6xl` with `font-bold`
- Section H2: `text-3xl` with `font-bold`
- Card H3: `text-lg` or `text-xl` with `font-semibold`
- Body: `text-base` or `text-lg`
- Small text: `text-sm`

## Component Styling

### Buttons
- **Primary CTA**: `bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg shadow-lg hover:from-green-600 hover:to-emerald-700`
- **Secondary**: `bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50`
- **Outline**: `border-2 border-green-500 text-green-600 rounded-lg hover:bg-green-50`

### Cards
- Background: `bg-white` or `bg-gray-50`
- Border radius: `rounded-xl` or `rounded-2xl`
- Shadow: `shadow-lg` for prominent cards
- Hover state: `hover:shadow-xl transition-all`

### Navigation
- Fixed header with `bg-white/80 backdrop-blur-md`
- Border bottom: `border-b border-gray-100`
- Height: `h-16`

### Footer
- Background: `bg-gray-50` or `bg-gray-900` for dark variant
- Border top: `border-t border-gray-100`

## Layout Patterns

### Containers
- Max width: `max-w-7xl mx-auto`
- Padding: `px-4 sm:px-6 lg:px-8`

### Sections
- Vertical padding: `py-20` or `py-24`
- Alternating backgrounds for visual separation

### Grids
- Features: `grid md:grid-cols-3 gap-8`
- Pricing: `grid md:grid-cols-2 lg:grid-cols-4 gap-8`
- Two-column layouts: `grid lg:grid-cols-2 gap-12`

## Animation & Transitions
- Page load animations: `transition-all duration-700`
- Hover effects: `transition-all duration-300`
- Use subtle opacity and translate transforms for entrance animations

## Iconography
- Use Lucide React icons
- Icon containers: `w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center text-green-600`

## Images & Assets
- Hero images should have subtle shadows or floating effect
- Use `rounded-2xl` for large images
- Company logos in carousels should be grayscale or muted

## Dark Mode Considerations
- Not required for marketing pages
- Dashboard should support dark mode with proper contrast
