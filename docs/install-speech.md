# Speech runtime installation and diagnostics

Videoer's deterministic dialogue subsystem requires eSpeak NG 1.52 or newer and a C compiler. eSpeak NG is open-source under GPL-3.0-or-later; it does not require a commercial licence or a hosted account.

The runtime has two deliberately separate outputs:

- `espeak-ng` renders the persisted WAV source used by the soundtrack mixer.
- `scripts/speech/espeak_events.c` uses eSpeak NG's native callback API to record phoneme and word timestamps from the same text, voice, rate, and pitch configuration.

Videoer compiles that small event bridge into the campaign work area when its source is newer than the binary. Motion synthesis maps the native events to canonical morph targets and samples their weights on the campaign's exact frame grid. Verification rejects missing visemes, incompatible character geometry, invalid frame grids, and onset error beyond one frame. Soundtrack rendering rejects any speech cue that would be truncated by its declared interval.

## macOS

```bash
brew install espeak-ng
xcode-select --install  # only when cc --version fails
npm run video -- doctor
```

Homebrew installs headers and libraries under its formula prefix. Videoer resolves that prefix with `brew --prefix espeak-ng` and embeds the library path in the helper binary. For a non-Homebrew installation, set `VIDEOER_ESPEAK_NG_PREFIX` to the prefix containing `include/espeak-ng/speak_lib.h` and the eSpeak NG library directory.

## Debian and Ubuntu

```bash
sudo apt-get update
sudo apt-get install espeak-ng libespeak-ng-dev build-essential
npm run video -- doctor
```

## Failure policy

Do not substitute estimated word timing, a static mouth animation, a hosted voice provider, or clipped dialogue when either dependency is absent. Repair the documented runtime and rerun the doctor. Voice identity, text, rate, pitch, native event ledger, generated motion, and rendered audio are persisted as provenance so another campaign or machine can reproduce the result.
