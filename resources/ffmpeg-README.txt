Bundled ffmpeg
==============

This folder ships a static ffmpeg binary alongside packaged builds so video
export works without a system ffmpeg. It is downloaded by
scripts/fetch-ffmpeg.mjs from the BtbN FFmpeg-Builds project:

  https://github.com/BtbN/FFmpeg-Builds

Those are GPLv3 builds of FFmpeg (https://ffmpeg.org). FFmpeg is a trademark of
Fabrice Bellard, originator of the FFmpeg project.

To refresh the binary:  npm run fetch:ffmpeg -- --force
