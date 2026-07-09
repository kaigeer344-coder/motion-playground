# Overlay Studio

Overlay Studio is a local web editor for generating, previewing, editing, and exporting transparent short-video motion overlays.

It is built with React, TypeScript, and Vite. The app runs on localhost and does not require a desktop framework.

## Features

- Import a video for timing preview.
- Import SRT subtitles and generate overlay JSON with a configurable AI API.
- Import existing overlay JSON and edit the generated effects.
- Edit overlay position, scale, text content, font size, and timing.
- Timeline with video and effect tracks, snapping, trimming, dragging, and horizontal zoom.
- Built-in motion card library:
  - MetricFocus
  - CompareSplit
  - QuoteLockup
  - BarInsight
- Export transparent overlay video as MOV without compositing the original video.
- Export and import overlay JSON for repeatable workflows.

## Quick Start

```bash
npm install
npm run local
```

Open:

```text
http://127.0.0.1:5173/
```

## Desktop Launch Scripts

The project includes simple startup scripts:

- macOS: `Start Overlay Studio.command`
- Windows: `Start Overlay Studio.bat`

Double-clicking the script installs dependencies if needed, starts the local Vite server, and opens the browser.

## AI Configuration

Overlay Studio can call an OpenAI-compatible chat completion API from the local Vite dev server.

In the right settings panel, configure:

- API Base URL
- Model name
- API Key

The API key is stored only in your browser localStorage. Do not commit personal API keys or generated private content.

## Transparent Overlay Export

The transparent MOV export writes generated files to:

```text
~/Desktop/剪辑素材
```

The exported video contains only overlay effects with a transparent background. It does not include the original video frame.

## Overlay JSON

Overlay JSON contains timed cards using the existing card library only. Each overlay item includes:

- `id`
- `kind`
- `start`
- `end`
- `x`
- `y`
- `w`
- `fontSize`
- `scale`
- `text`

See the `overlays/` folder for sample JSON files.

## Development

```bash
npm run dev
npm run build
npm run lint
```

## Notes

- This project is a local web editor, not a full video editing suite.
- It does not use Remotion.
- It does not export the original video mixed with overlays.
- It is designed for generating overlay assets that can be imported into tools such as Jianying, Premiere Pro, Final Cut Pro, or other editors.

## License

MIT
