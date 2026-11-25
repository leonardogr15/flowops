#!/bin/sh
# Turns the Playwright recording (frontend/docs-output/approval-flow.webm) into:
#   - docs/images/approval-flow.gif        short, sped-up version for the README (committed)
#   - frontend/docs-output/flowops-approval-flow.mp4   full 1080p walkthrough (kept local, git-ignored)
#
# FFmpeg runs from the LinuxServer.io image (a third-party build, not an image published by the FFmpeg
# project), pinned by version and digest. It is only used here, never in FlowOps images, and runs with
# no network, no capabilities, a read-only root filesystem, a non-root user and only the output folder
# mounted. ffmpeg is called directly: the image's s6 init would need root.
set -eu

IMAGE="lscr.io/linuxserver/ffmpeg:9.0.2-cli-ls90@sha256:66fa8e2351fb78f9dad2c59c946be2658edcc529339320da3f2cf788312368af"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/frontend/docs-output"
[ -f "$WORK/approval-flow.webm" ] || { echo "Run the recording first (make demo-gif does it)." >&2; exit 1; }
# Seconds of blank page before the first screen, written by the recording spec.
START="$(cat "$WORK/approval-flow.start" 2>/dev/null || echo 0)"
# Docker Desktop on Windows needs a Windows path for the bind mount; elsewhere pwd is enough.
MOUNT="$(cd "$WORK" && (pwd -W 2>/dev/null || pwd))"
export MSYS_NO_PATHCONV=1

ffmpeg() {
  docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
    --read-only --tmpfs /tmp --user "$(id -u):$(id -g)" \
    --entrypoint ffmpeg -v "$MOUNT:/work" -w /work "$IMAGE" -hide_banner -loglevel error -y "$@"
}

ffmpeg -ss "$START" -i approval-flow.webm -an -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart \
  flowops-approval-flow.mp4
# GIF: 1.6x speed, 6 fps, 960 px wide, 112 colours (keeps the status colours), one optimized palette for the whole clip.
ffmpeg -ss "$START" -i approval-flow.webm -filter_complex \
  "setpts=PTS/1.6,fps=6,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=112:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  approval-flow.gif

mkdir -p "$ROOT/docs/images"
cp "$WORK/approval-flow.gif" "$ROOT/docs/images/approval-flow.gif"
ls -l "$ROOT/docs/images/approval-flow.gif" "$WORK/flowops-approval-flow.mp4"
