
## Dakhni (dk)

Taster of 10 lines (ElevenLabs v3 via Imagine Art MCP, stock American/British voices, speed 1). Files: public/audio/tiffin-voices/dk/<lineId>.mp3, manifest.dk.json, records/dk.json (text sent, display text, voice, stability, track id, source URL). Two lines were lightly respelled for the TTS (angry-leave-01: kabi, idhar; inspector-arrival-05: spelled-out GHMC); display text is unchanged in the game. Validated by size, MP3 header and a frame-walk duration reader only; nothing was auditioned. Balance 15,080 -> 14,923 (157 credits for 10 clips).

## Hindi (hi) taster

10 lines recorded with ElevenLabs v3 through the Imagine Art MCP `generate_speech` (`org_id` empty, `speed` 1, `similarity_boost` default).
Clips: `public/audio/tiffin-voices/hi/<lineId>.mp3`; index: `public/audio/tiffin-voices/manifest.hi.json`.
Generation record (text sent with its tag, voice, stability, track id, source URL): `scripts/tiffin-voices/records/hi.json`.
Only lines without `{dish}`, `{dish2}` or `{n}` are recorded. The text sent is `<tag> <Devanagari line>`; mood maps to tag
(angry -> [angry] at stability .3, impatient -> [sighs], delighted -> [excited], sheepish -> [nervous], neutral -> none, etc.).
To regenerate a line, send the `text` from the record with the same voice and stability, then download
`https://asset.imagine.art/processed/<track id>` (audio/mpeg) over the same file name.
The accent of the American/British stock voices speaking Hindi has not been checked by ear.

## Telugu (te) taster

10 lines (one per situation/emotion) recorded with ElevenLabs v3 through the Imagine Art MCP `generate_speech` (`org_id` empty string, `similarity_boost` default). Only lines without `{dish}`, `{dish2}` or `{n}` are used.
Clips: `public/audio/tiffin-voices/te/<lineId>.mp3`; index: `public/audio/tiffin-voices/manifest.te.json`; generation record (text sent with tag, voice, stability, speed, track id, source URL): `scripts/tiffin-voices/records/te.json`.
The text sent is `<tag> <Telugu-script line>` (never the Roman or English). Emotion map: angry -> [angry] (stability .3; [shouts] for the furious walk-out), impatient -> [sighs] (.35), delighted -> [excited], happy -> [happy], sheepish -> [nervous], paying/calm -> [calm] or [happy], sarcastic complaints -> [sarcastic], inspector arrival -> [whispers], neutral/eating -> no tag (stability .5).
Voices by speaker: elder/uncle -> George; women/family -> Aria, Laura, Sarah; students/techies and others -> Liam, Will, Chris, Brian, Charlie, Roger. Voice per line is fixed in the record.
To regenerate a line: call `generate_speech` with the record's `textSent`, `voice`, `stability`, `speed`, wait with `fetch_status` (`sync: true`), then download `https://asset.imagine.art/processed/<track id>` (audio/mpeg) over the same file name and update `ms` in the manifest (duration is computed by walking the MP3 frames).
Validation done: HTTP 200, audio/mpeg, 8-400 KB, ID3 or frame sync, frame-walk duration. Nothing was auditioned: Telugu pronunciation by American/British stock voices is unverified by ear.
