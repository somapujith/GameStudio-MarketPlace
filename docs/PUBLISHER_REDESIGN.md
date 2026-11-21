# Publisher redesign

Class: frontend. Goal: improve secondary screens and small interactions while preserving the homepage from main, per the user's updated direction.

## Direction

Secondary screens use an arcade record sleeve direction: warm paper, charcoal, orange, Bricolage typography, small numbered captions and fine rules. Homepage hero, art, layout, game cards, navigation and footer retain their main source and presentation. Shared buttons gain tactile feedback without replacing the homepage design. Upcoming titles remain clearly labelled.

Signature: a split launch control with a square arrow cell, short mechanical press travel, and an arrow that moves toward its destination on hover. Covers reveal a play/explore treatment on hover and keyboard focus. No cursor replacement or motion-dependent interaction.

Foundation: existing brand and hub tokens, Bricolage display / Plus Jakarta body, spacing 8/16/24/32/48/64, radii 2/4/8, existing --ease-out and --dur-1/--dur-2. Feedback uses 120–160ms press and 220ms reveal transitions. Hover movement only for fine pointers; OS and in-app reduced motion both supported.

## Work packages

0. Parent: shared control foundation in src/styles/publisher.css, imported by App after current brand styles.
1. Parent: publisher-screens.css; sign-in hierarchy, input contrast, avatar feedback and secondary panel consistency. Homepage source restored to main.
2. Micro worker: publisher-micro.css; room code entry, search palette, dialogs, switches, segmented controls, toasts and tab feedback.
3. Catalog worker: Games.jsx, BrowseCard.jsx, BrowseRow.jsx and publisher-catalog.css; preserve filters, URLs and source facts. No homepage card styles.
4. Detail worker: GameDetail.jsx and nawabi-detail.css; clear setup panel and tactile split launch control. Modal.jsx fixes focus restoration after closing.
5. Integration: parent resolves cascade and cross-route consistency; game rules, API, auth and saved data remain out of scope.

## Acceptance

Build and existing relevant tests pass. Inspect home, catalog, live detail, login and social pages at desktop and mobile, check 360/768/1440 layouts and horizontal overflow, primary navigation, search/code dialogs, filters and notification toggles. Verify focus and reduced motion. Keep network failures honest; do not invent player or table counts. Preserve untracked personal assets. No commit or deployment requested.
