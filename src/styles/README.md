CSS structure

- tokens.css: Global CSS variables and custom properties.
- base.css: Reset, html/body/root, app shell and nav.
- index.css: Modular entry that imports tokens, base, and legacy.
- components.css: Temporary home for component styles while migrating; split later.

Migration plan

- Keep importing `../index.css` from `styles/index.css` to avoid regressions.
- As you move blocks into `components.css` (or per-component files), remove them from the legacy `src/index.css`.
- Maintain order: tokens -> base -> components. Keep variables in tokens only.
- Prefer colocated component styles next: e.g. styles/components/pdf.css, settings.css, reader.css.

