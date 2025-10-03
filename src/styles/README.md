CSS structure

- tokens.css: Global CSS variables and custom properties.
- base.css: Reset, html/body/root, app shell and nav.
- index.css: Modular entry that imports tokens, base, and all component files.
- components/: Modular component-specific styles directory.
  - pdf-viewer.css: PDF viewer and navigation controls.
  - debug.css: Debug panel and logging utilities.
  - selection-toolbar.css: Text selection and TTS controls.
  - reader.css: Reader view and TTS interface.
  - dropdown.css: Glass dropdown components and menus.
  - settings.css: Settings view, models, and configuration.
  - library.css: Library view, items, and management.
  - voice-filters.css: Voice filtering and search controls.
  - common.css: Shared utilities, buttons, and common states.
- theme-overrides.css: Light theme overrides (must be imported last).

Migration status

✅ **COMPLETED**: The giant components.css file has been successfully split into modular component files.
- Each component now has its own dedicated CSS file.
- Shared utilities and common patterns are centralized in common.css.
- All imports are properly ordered in index.css to maintain cascade behavior.
- The original components.css file has been removed.

Benefits achieved:
- **Maintainability**: Easier to locate and modify component-specific styles.
- **Scalability**: New components can get their own CSS files.
- **Development**: Cleaner workflow when working on specific features.
- **Performance**: Better caching and potential for future code splitting.

