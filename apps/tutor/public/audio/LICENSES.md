# Audio assets for listening-comprehension presets

The full-text TTS player can apply acoustic effects (Room/Hall convolver
reverb) and mix in ambient background noise (Street / Café / Club). The
presets degrade gracefully when their asset files are absent — the user just
hears a dry signal — so the app ships without these files committed.

To enable the wet presets, drop the following files into the paths below.
Listed sources are suggestions; any short impulse response or short ambient
loop with a compatible license will work.

| Preset | Path | What to put there | Suggested source |
|---|---|---|---|
| Hall      | `public/audio/effects/hall.wav` | Concert hall impulse response, ≈2–3 s, mono 24 kHz | [OpenAIR](https://openair.hosted.york.ac.uk/) — Concert hall IRs (CC-BY 4.0) |
| Far field | `public/audio/effects/far.wav`  | Far-field / distant-speaker impulse response (open space or large room), ≈1–2 s, mono 24 kHz | OpenAIR — Outdoor/large-space IRs (CC-BY 4.0) |
| Street    | `public/audio/noises/street.mp3` | Urban traffic ambience loop, 30–60 s | [freesound.org](https://freesound.org/) — filter to **License: CC0** |
| Crowd     | `public/audio/noises/crowd.mp3`  | Crowd / chatter loop (no music — to avoid clash with TTS), 30–60 s | freesound.org CC0 |

## Notes on encoding

- The convolver assets must be PCM WAV (Web Audio's `decodeAudioData` accepts
  WAV, MP3, OGG; WAV is what OpenAIR ships and avoids any decoding edge
  cases on long IRs). Anything 16-bit / 24 kHz mono is fine.
- The ambient loops are encoded as MP3 to keep the bundle size modest (each
  file budget ~0.5–1.5 MB). They get pre-loaded the first time the user
  picks the corresponding preset and cached for the AudioContext lifetime.
- Avoid loops that audibly thump at the seam — Web Audio's `loop = true`
  doesn't crossfade. Most freesound CC0 ambient recordings are taken from
  long sessions and don't have this problem; if yours does, top-and-tail it
  in Audacity until the seam is inaudible.

## Attribution

CC0 sources require none, but **CC-BY sources do**. When adding a CC-BY file,
append an entry below with the title, author, source URL, and license:

> _example_:
> - `effects/hall.wav` — "St Andrew's Church IR" by Audiolab, University of
>   York — [https://openair.hosted.york.ac.uk/?page_id=482](https://openair.hosted.york.ac.uk/?page_id=482) — CC-BY 4.0
