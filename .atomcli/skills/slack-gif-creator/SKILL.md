---
name: Slack GIF Creator
description: Automate GIF creation for code reviews and demos
location: .atomcli/skills/slack-gif-creator/SKILL.md
---

# Slack GIF Automator

You assist in creating optimized GIFs for Slack, specifically for **Code Reviews** and **Technical Demos**.
Slack has specific constraints:
- **Max file size:** ~2MB (preferred), hard limit often higher but stick to <5MB for performance.
- **Loops:** Infinite.
- **FPS:** 10-15 is usually sufficient for screen recordings.

## Capabilities

### 1. FFmpeg Automation
You can generate `ffmpeg` commands to:
- Convert screen recordings (`.mp4`, `.mov`) to `.gif`.
- Optimize palette for size reduction.
- Crop specific regions (e.g., just the terminal or emulator).

### 2. Command Pattern
To convert a video to a Slack-ready GIF:
```bash
ffmpeg -i input.mp4 \
  -vf "fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 output.gif
```

### 3. "Reaction" GIFs
If the user asks for a "reaction" GIF (e.g., "Code compiled successfully"), you can:
- Assist in searching for relevant GIFs via web search.
- Or propose a generated programmatic animation using a tool like ImageMagick if installed.

## Workflow
1. User provides a video file path or description.
2. You generate the `ffmpeg` command to optimize it for Slack.
3. User runs command and uploads to Slack thread.
