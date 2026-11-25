# Autowala voices

Spoken lines for Autowala: customers hailing the auto ("Babu auto!"), passengers riding, angry drivers in a chase, and an original
fictional hero narrator, **Mega Hero**, cheering you on at milestones. The shipped game makes **no network call to any voice or AI
API**: the audio is generated **offline** by `scripts/gen-voicelines.mjs` and served as static files from
`public/audio/autowala/voices/` (CSP: `connect-src 'self'`, `media-src 'self' blob: data:`).

| File | Role |
| --- | --- |
| `src/games/autowala/audio/voiceLines.js` | the catalogue (data only): personas, voice briefs, ~160 lines with Telugu / roman / English |
| `src/games/autowala/audio/voice-select.js` | pure logic: customer kind -> persona, line picker (cooldowns, no repeat of the last 3), priority scheduler |
| `src/games/autowala/audio/voice-math.js` | pure maths: positional pan / distance gain (audible to 90 m), subtitle timing |
| `src/games/autowala/audio/voice-player.js` | Web Audio playback, index loading, speechSynthesis / chime fallback |
| `src/games/autowala/audio/voices.js` | `installVoices(ctx)`: event triggers |
| `src/games/autowala/ui/Subtitles.jsx` + `subtitles.css` | the subtitle bar (`<Subtitles game={game} />`, mounted in `AutowalaGame.jsx`) |
| `scripts/gen-voicelines.mjs` | the offline generator (provider adapters: `imagine`, `mock`) |

## What imagine.art offers (researched 2026-11-25)

**VERIFIED in the docs**
- The public ImagineArt API lives at `https://api.imagine.art/v1`; auth is `Authorization: Bearer <key>`; keys are created at
  <https://open.imagine.art/keys> and can carry a credit cap (a request over the cap fails with 402 / code 1210).
  Sources: <https://docs.imagine.art/api/introduction.md>, <https://docs.imagine.art/api/authentication.md>.
- Generation is **asynchronous**: `POST /image/generate` or `POST /video/generate` with `{ "model": "...", "input": { ... } }` returns `202`
  with an `id` and `data.status: "pending"`; poll `GET /generations/{id}/status` (every 3 s for images) until `data.status` is
  `completed` or `failed`; finished outputs are signed CDN URLs valid 166 hours (`images[].url`). Fields not listed for a model return 400.
  Sources: <https://docs.imagine.art/api/quickstart.md>, <https://docs.imagine.art/api/generations.md>.
- Rate limits per organisation: 1,000 POST/PUT/PATCH and 200 GET per minute; over the limit you get `429` with `Retry-After`.
  Source: <https://docs.imagine.art/api/rate-limits.md>.
- The **web app** has a Text-to-Speech tool (models ElevenLabs v3/v4, MiniMax Speech 2.8 HD/Turbo; speed / pitch / volume; emotions Happy, Sad,
  Angry, Fearful, Disgusted, Surprised, Neutral; generic voice names such as "Wise Woman", "Deep Voice Man", "Imposing Manner"; "multiple
  languages"; up to 5,000 characters per generation).
  Sources: <https://docs.imagine.art/text-to-speech.md>, <https://docs.imagine.art/audio-tools.md>, <https://docs.imagine.art/generate-voice.md>.

**NOT found / UNVERIFIED**
- The public **API model list (8 models) has no text-to-speech model**: only image, image-edit/enhance and video models
  (<https://docs.imagine.art/api/models.md>, <https://docs.imagine.art/api/model-reference.md>). No TTS endpoint, request shape, response shape,
  voice id list or TTS price is documented. The `imagine.art/gen-api` page does not mention audio either.
- **Telugu**: the docs say all voices "support multiple languages" without naming them. Telugu is neither confirmed nor ruled out.
- **Pricing for speech**: not published. `GET https://api.imagine.art/v1/cost` (public) lists current API prices; check it, or the dashboard.
  The generator prints the character count (about **4,200 characters** for the whole catalogue) and only prints a money estimate if you
  set `IMAGINE_COST_PER_1K_CHARS`.
- The "Voice Cloning" docs page advertises speech "in the voice of real people". **We never use it** (see the rules below).

So the `imagine` adapter is built on the verified async pattern (Bearer auth, `POST /<kind>/generate`, poll `/generations/{id}/status`, signed
CDN download without the key) and **guesses the rest**, all of it marked UNVERIFIED in the code and configurable by environment variable:

| Setting | Default | Notes |
| --- | --- | --- |
| `IMAGINE_API_KEY` | none (required) | the only place the key is read |
| `IMAGINE_TTS_MODEL` | none (required) | no TTS model id is documented: copy one from `GET /models` or the dashboard once available |
| `IMAGINE_TTS_PATH` | `/audio/generate` | UNVERIFIED (by analogy with `/image/generate`, `/video/generate`) |
| `IMAGINE_API_BASE` | `https://api.imagine.art/v1` | |
| `IMAGINE_TTS_INPUT_MAP` | `{}` | JSON renaming/dropping the `input` fields, e.g. `{"text":"prompt","pitch":null}`; defaults are `text, voice, language, speed, emotion, pitch` (UNVERIFIED) |
| `IMAGINE_VOICE_<PERSONA>` | persona's generic voice name | e.g. `IMAGINE_VOICE_MEGA_HERO` overrides the voice for one persona |
| `IMAGINE_COST_PER_1K_CHARS` | none | only to get a cost estimate printed |

If imagine.art does not (yet) expose TTS over the API, or has no Telugu voice, swap the provider: add one factory to `scripts/gen-voicelines.mjs`
returning `{ name, generate({ text, lang, persona, style }) -> { bytes, ext } }` and register it in `PROVIDERS`. Nothing else changes.

## How to generate

```powershell
# 1. look first (no key, no network): the plan and the character count
node scripts/gen-voicelines.mjs --provider imagine --dry-run

# 2. real run. The key lives only in this one PowerShell command; never put it in a file or an argument.
$env:IMAGINE_API_KEY='...'; $env:IMAGINE_TTS_MODEL='...'; node scripts/gen-voicelines.mjs --provider imagine
Remove-Item Env:IMAGINE_API_KEY, Env:IMAGINE_TTS_MODEL   # afterwards

# options
node scripts/gen-voicelines.mjs --provider imagine --only mega_hero          # one persona (or line ids, or a category)
node scripts/gen-voicelines.mjs --provider imagine --only hail_eld_m1 --force # redo one file
node scripts/gen-voicelines.mjs --provider mock                              # tiny placeholder .wav files, no network
```

Costs real money: the whole catalogue is about 4,200 characters; start with `--only mega_hero` and listen before running everything. Files
that already exist are skipped (so a re-run only fills gaps) unless `--force`. Requests retry with backoff (honouring `Retry-After`); a
401/402/403 stops the run. The script never prints, stores or accepts the key as an argument (it is redacted from every log line).
It writes `<id>.mp3` (or the provider's format) and `index.json` (`{ version, generated, lines: { id: { file, ms, persona } } }`) into
`public/audio/autowala/voices/`. Commit those files (a few hundred KB of mp3 at most). The mock placeholders should NOT be committed.

Suggested npm script (not added, `package.json` is not ours): `"voices:gen": "node scripts/gen-voicelines.mjs"`.

## What the game does at runtime

- `installVoices(ctx)` fetches `/audio/autowala/voices/index.json` once. A 404 (no files yet) is the normal state: lines then play in
  fallback mode. Buffers are decoded once and cached; the hero lines are warmed after the first key press / click.
- **Positional**: customer hail / missed lines are panned and attenuated relative to the camera (audible up to 90 m, muffled with distance).
  Customers you drive close to call again every ~18 s.
- **Priority**: one voice at a time. A hero line never overlaps another hero line or a passenger line (it waits up to 12 s) and is never cut
  off; a crash reaction cuts in over chatter / hails. Per-persona and global cooldowns; a line is never repeated within the last 3.
- **Fallback** when a file is missing: the subtitle still shows; if `profile.data.settings.voice` is not `false` and the browser has a Telugu
  (`te-IN`) speech voice it speaks the line (pitch / rate per persona), else a short chime. `isMuted()` and `settings.sound === false` silence
  audio (subtitles stay). `settings.voice === false` turns off all spoken audio and the speech fallback.
- Every line emits `voice:line { id, text, te, roman, en, persona, personaName, speaker, color, hero, ms, mode }` for the subtitle bar.
- Triggers: `fare:hail`, `fare:pickup`, `fare:dropoff`, `fare:missed`, `crash`, `land`, `drift-end`, `wallet`, `workshop:buy`,
  `rage:start / shout / escaped / caught`, `traffic:hit`, and polled: night begins, rain, low fuel, back at the garage.
  First-time hero lines (first fare, Rs 1000, Rs 5000, first workshop purchase) play once per account per device.
- Debug: `__autowala.ctx.voices.say('hero_first_1')`, `.hail({ kind: 'elder', x, z, name })`, `.stats()`.

## Telugu review (do this before release)

The Telugu was written by a non-native reviewer as colloquial Hyderabadi street speech (with Hindi/English words in Telugu script, as people
actually talk). **A native-speaker review is recommended before release**: check spelling, register (babu / anna / nayana / amma forms), the
elders' phrasing, and the Hinglish shouts. Send the reviewer `voiceLines.js` (each line has `te`, `roman`, `en`) or a spreadsheet export of
it; fix `te` / `roman` there. Then regenerate only what changed: `--only <id> --force`. Listen to the audio too: TTS often mispronounces
mixed-script words (OYO, Bawarchi, "Delhi Mithai Wala"); respell them in Telugu script if so.

## Adding lines or personas

- **Line**: add a row inside the right `P('<persona>', '<category>', [...])` block in `voiceLines.js`: `[id, te, roman, en, extra]`. `id` is the
  file name (lowercase `a-z0-9_`, never renumber an existing one). `extra`: `kind` (hail lines: one of regular, rusher, elder, women, tourist,
  student), `place` (hail lines naming a place: bawarchi, paradise, oyo, delhi_mithai, metro), `dest` (boarding lines: a poi id), `mood`
  (happy, sad, angry, fearful, surprised, neutral), `weight`. Keep it to 1-4 seconds (<= 70 characters). The tests check the Telugu block,
  unique ids and the required categories. Run `node scripts/gen-voicelines.mjs --provider imagine` to fill only the new files.
- **Persona**: add an entry to `PERSONAS` (name, colour, `brief`, `voice`, `speech`), map it in `personaForKind` (voice-select.js) if it is a
  customer kind, and add lines. The brief describes age, tone, pace and accent in plain words.
- **New trigger**: add a `case` in `handleEvent` in `voices.js` (call `say({ category, persona })`).

## Rules

- **No real-person voice cloning, imitation or sound-alikes**, living or dead (actors, politicians, celebrities, anyone). Voice briefs never say
  "like <someone>". Mega Hero is an original fictional narrator with original lines and no catchphrases from real films or people; the display
  name is one string (`PERSONAS.mega_hero.name`) if you want a different one. The tests reject "sounds like / in the style of" in briefs.
- **No secret in the repo.** The key is only ever `process.env.IMAGINE_API_KEY` in the offline script.
- Place names in hail lines (Bawarchi, Paradise, OYO, Delhi Mithai Wala, metro) are plain names, no advertising claims; angry-driver lines are
  comic, with no slurs or threats.
- **Disclose AI voices.** The recordings are AI-generated. Add an in-game credit line, e.g. in the Autowala credits / pause menu:
  "Voices: AI-generated (original fictional characters). No real person's voice is used."
