# Add Shivam’s narration to the captured walkthrough

The silent walkthrough is **3 minutes 18 seconds**, 1920×1080, H.264, 24 fps, yuv420p. It uses actual captured Thesis application views, enlarged crops and a separately labeled card of fields from retained JSON model receipts. It is an annotated captured walkthrough, not a claim of continuous interaction or a live end-to-end sponsor run.

## Record your own voice

Use `video-narration-script.txt` for the exact 411-word narration and `video-run-of-show.md` for scene timings. Read at about 125 words/minute, with short pauses between chapters. No synthetic voice or impersonation is included.

The video’s abstention view shows a 40% return goal, 10% volatility tolerance, 10% observed-drawdown tolerance and a 3-year horizon. The narration matches those captured values. Use this video-specific script when adding voice to this file. The separate deck/demo recording guide uses a different illustrative mandate.

Record a clean WAV file named `shivam-narration.wav`. Aim for speech to finish by 3:16, leaving a short closing pause. First check its duration:

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 shivam-narration.wav
```

If your narration exceeds 198 seconds, rerecord or revise the edit before muxing, so the ending stays intact.

## Mux the narration

From this folder, with FFmpeg installed:

```bash
ffmpeg -i thesis-demo-silent.mp4 -i shivam-narration.wav \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11,apad" \
  -shortest -movflags +faststart thesis-demo-narrated.mp4
```

This preserves the already encoded video. The audio filter normalizes narration volume and pads the closing pause.

## Optional selectable captions

`captions.srt` matches the concise on-screen annotations and scene boundaries. These captions summarize the scenes. They are not a verbatim transcript of the spoken script.

To include them as a selectable English subtitle track:

```bash
ffmpeg -i thesis-demo-narrated.mp4 -i captions.srt \
  -map 0:v:0 -map 0:a:0 -map 1:0 \
  -c:v copy -c:a copy -c:s mov_text \
  -metadata:s:s:0 language=eng -movflags +faststart \
  thesis-demo-captioned.mp4
```

## Before submission

Watch the narrated result and check scene synchronization, speech clarity and the final words. The current video explicitly labels synthetic market inputs and pending live Zetaris verification. Qwen and Nemotron receipts prove specific model features, not complete connected-mode availability or financial correctness. Update the video only after fresh evidence supports a changed sponsor status.

The video is a prepared media asset. It has not been uploaded to HackOS. A human recording, final review and submission step remain.
