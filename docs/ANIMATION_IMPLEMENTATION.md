# Kingpin artwork and motion

Class: frontend. Build a lively miniature Hyderabad using layered SVG scenes, illustrated event cards, expressive tokens, and a contextual auto mascot. Preserve existing rules, routes, server timing, user layout edits, keyboard controls, and reduced-motion settings.

Visual direction: warm illustrated city dioramas, ink outlines, cream architecture, collection colours, teal night skies, and gold for money. Existing fonts, spacing, duration and easing tokens remain authoritative. The signature is a location scene that responds to the current gameplay moment. Price, rent, outcome and the next action remain readable and stationary.

Work packages:
- Locations: new LocationScene SVG component and isolated stylesheet; integrate into property sheets. Cover all 24 districts and special tiles, with recognizable local details and three business levels.
- Event cards: new EventCardArt SVG component, per-card illustration mapping and isolated stylesheet; integrate artwork and preserve card IDs in CardReveal. Cover both 18-card decks.
- Character motion: new AutoMascot component and isolated stylesheet; articulate the six existing tokens and enrich the home/lobby/result moments using bounded animation.
- Integration (root): contextual gameplay stage in ControlPanel using existing presenter state, scene priorities, interruption and reconnect handling. No additional server waits.

Verification: production build; focused art/mapping, presenter and card tests; responsive browser checks at phone, tablet, desktop, short landscape; keyboard dismissal, reduced motion, missing/unknown IDs and replay/catch-up. Use deterministic local browser fixtures for gameplay without mutating shared rooms. Live multiplayer and real-device performance remain separate checks.

## Delivered

- LocationScene: 24 explicit district scenes, special-square settings, business levels, finite articulated details; integrated into property sheets and the central play stage.
- EventCardArt: all 36 cards across 14 scene families, SVG card backs, repeated-draw animation identity, complete rules/outcomes. The reveal uses a viewport-bound portal to avoid small-board clipping.
- AutoMascot: seven contextual poses; six tokens have independent moving parts. Home, lobby, results, friends and login use contextual character artwork.
- City cover: Metro follows its isometric viaduct, auto follows its road, lake shimmer and lights settle after bounded sequences.
- Gameplay stage: presenter-driven travel, purchase, upgrade, payment, traffic, chai and city-event treatments. Small die during place decisions, large die while rolling; accessible event history remains available.
- Shop and badges: selected cosmetic artwork feedback and newly earned badge reveals when they enter view.
- Existing reduced-motion preferences supported throughout. No new libraries, backend rules or server delays.

## Verification evidence

The workspace-wide suite passed 1,063 tests in 78 files. Production build passed. Focused presenter, scene, card, location and character tests cover metadata, reset cancellation, unknown IDs and rendering.

Chromium checks used 320x568, 390x844, 768x1024, desktop 1440px and landscape 844x390. Verified sample purchase playback, property-sheet Escape dismissal, all 36 card illustrations, unique SVG IDs, repeated card flips, portal cleanup, and both OS/app reduced motion. Art galleries and gameplay fixtures are local ignored artifacts in output/playwright, not product routes.

Representative captures: scene-phone.png, card-board-320-fixed.png, property-location-phone.png, cards-gallery.png, locations-gallery.png, home-city-motion.png, shop-preview-phone.png. Live multiplayer, account mutations and real-device frame rates were not verified. The isolated gameplay fixture can emit existing browser autoplay/haptic-policy messages; login can emit external Google resource errors.
