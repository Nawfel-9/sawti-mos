# Darija Voice Test (Sawti-TTS MOS)

A one-page blind listening test for the Sawti-TTS evaluation. Listeners hear 32 short Darija clips in a random
order (never the same sentence twice in a row), listen to each to the end, and rate:

- **naturalness** 1–5 (Bad, Poor, Fair, Good, Excellent): this is the MOS;
- **ease of understanding** 1–5.

The page opens in Darija (Arabic script, right to left); the switch at the top left changes it to English or
French in one click, and the choice is remembered. Only the labels change: the values saved (yes/no, region, age)
are the same in every language. Texts are in `i18n.js`.

Each rating is sent at once to a Google Sheet through a Google Apps Script web app. If the connection drops,
ratings wait in the browser and are sent later. A listener who reloads the page resumes where they stopped.

The page never names the systems. Which system made which clip (`key.csv`) stays in the Sawti repository
(`sawti_tts/runs/eval/mos/key.csv`, git-ignored). Do not add it here: this repository is public.

## Files

| file | what |
|---|---|
| `index.html`, `style.css`, `app.js` | the page (no build step, no external libraries) |
| `i18n.js` | interface texts in Darija, English and French |
| `config.js` | the Apps Script URL; empty = test mode, nothing is saved |
| `clips/clip_001.wav` … `clip_032.wav` | the clips, 16 kHz mono, loudness-matched |
| `clips.json` | clip ids + anonymous sentence groups (used only to space out repeats of a sentence) |
| `apps-script/Code.gs` | the script that writes ratings into the Sheet |

## Setup (once)

1. Create a Google Sheet (any name).
2. In the Sheet: **Extensions → Apps Script**. Replace the contents of `Code.gs` with `apps-script/Code.gs`, then save.
3. **Deploy → New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Authorize when asked. Copy the **Web app URL** (it ends in `/exec`).
4. Open the URL in a browser: it should show `{"ok":true,"service":"sawti-mos"}`.
5. Put the URL in `config.js` (`endpoint: "https://script.google.com/macros/s/…/exec"`), commit and push.
   The yellow "Test mode" banner disappears from the page.
6. Take the test once yourself and check that rows appear in the `ratings` tab. Then delete those rows.

If you change `Code.gs` later: **Deploy → Manage deployments → Edit → Version: New version**. Keep the same URL.

## The data

Tab `ratings`, one row per event:

| column | meaning |
|---|---|
| `received_at` | server time (UTC) |
| `session_id` | random id per listener (no name, no email) |
| `event` | `start`, `rating` or `finish` |
| `clip` | `clip_001` … (ratings only) |
| `position` | 1 = first clip this listener heard |
| `naturalness`, `intelligibility` | 1–5 |
| `plays` | times the clip was played from the start |
| `seconds` | from the first play to pressing Next |
| `native`, `headphones`, `region`, `age_range` | the listener's answers on the first screen |
| `client_time`, `version` | browser time; test version (`v1`) |

When the test is over: **File → Download → Comma-separated values (.csv)** on the `ratings` tab. Then, in the Sawti repository:

```
python -m sawti_tts.evaluation.mos_analyze --sheet <ratings>.csv --drop-bad
```

## Credits

The real recordings among the clips come from the **DODa audio dataset**
([atlasia/DODa-audio-dataset](https://huggingface.co/datasets/atlasia/DODa-audio-dataset)), released under the
MIT License. The other clips are synthesized by the Sawti-TTS models.

When you change `style.css`, `config.js`, `i18n.js` or `app.js`, raise the `?v=` number on its link in `index.html`: GitHub Pages lets browsers cache files for 10 minutes, and a new page with an old script breaks.
