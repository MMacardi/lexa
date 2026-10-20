"""Measure existing WAVs without editing audio or using recognized text as evidence.

Install praat-parselmouth/numpy/scipy/matplotlib into .playwright-cli/tts-tools/python.
Run from project root: python -B backend/scripts/analyze-word-pitch.py [--diction]
"""
import html
import hashlib
import json
import os
import struct
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".playwright-cli/tts-tools/python"))
DICTION = "--diction" in sys.argv
OUT = ROOT / (".playwright-cli/word-audio/diction-measurements" if DICTION else ".playwright-cli/word-audio/pitch")
OUT.mkdir(parents=True, exist_ok=True)
os.environ["MPLCONFIGDIR"] = str(ROOT / ".playwright-cli/tts-tools/matplotlib")
import numpy as np
import parselmouth
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.signal import spectrogram

SOURCE = ROOT / ".playwright-cli/word-audio/engines"
FILES = [
    ("F-序.wav", "xu4, isolated, synthesis 0.9"),
    ("F-顺序.wav", "shun4 xu4, synthesis 0.9"),
    ("F1-序.wav", "xu4, isolated, synthesis 1.0"),
    ("F1-顺序.wav", "shun4 xu4, synthesis 1.0"),
    ("F1-序。.wav", "xu4 + full stop, synthesis 1.0"),
    ("F1-顺序。.wav", "shun4 xu4 + full stop, synthesis 1.0"),
    ("F1-虚.wav", "xu1, tone 1 control"),
    ("F1-徐.wav", "xu2, tone 2 control"),
    ("F1-许.wav", "xu3, tone 3 control"),
    ("F1-续.wav", "xu4, homophone control"),
    ("F1-去.wav", "qu4, tone 4 control"),
]
if DICTION:
    FILES = [(f"{candidate}-{text}.wav", f"{candidate}, {text}")
             for text in ("序", "顺", "味", "去", "顺序", "味道")
             for candidate in ("F1", "H1", "H2", "H3")]


def spans(times, mask):
    indices = np.flatnonzero(mask)
    groups = np.split(indices, np.flatnonzero(np.diff(indices) > 5) + 1)
    return [(float(times[g[0]]), float(times[g[-1]])) for g in groups if len(g) > 5]


def analyze(file, label):
    # Sambert's streamed WAV has a placeholder (~2 GB) data size. Bound the PCM
    # to the actual downloaded bytes instead of asking Praat to pad that header.
    blob = (SOURCE / file).read_bytes()
    offset, channels, rate, bits, pcm = 12, None, None, None, None
    while offset + 8 <= len(blob):
        chunk, size = blob[offset:offset+4], struct.unpack_from("<I", blob, offset+4)[0]
        start = offset + 8
        if chunk == b"fmt ":
            fmt, channels, rate = struct.unpack_from("<HHI", blob, start)
            bits = struct.unpack_from("<H", blob, start+14)[0]
            if fmt != 1:
                raise ValueError("Expected uncompressed PCM")
        if chunk == b"data":
            pcm = blob[start:min(start+size, len(blob))]
            break
        offset = start + size + size % 2
    if bits != 16 or not channels or not rate or not pcm:
        raise ValueError(f"Invalid 16-bit WAV: {file}")
    frame_bytes = 2 * channels
    pcm = pcm[:len(pcm)//frame_bytes*frame_bytes]
    # Listening copies repair only the streamed WAV's length fields. PCM is
    # byte-identical: no trimming, speed/pitch changes, fades, or resynthesis.
    (OUT / "audio").mkdir(exist_ok=True)
    with wave.open(str(OUT / "audio" / file), "wb") as output:
        output.setparams((channels, 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(pcm)
    with wave.open(str(OUT / "audio" / file), "rb") as check:
        assert check.readframes(check.getnframes()) == pcm
    values = np.frombuffer(pcm, dtype="<i2").reshape(-1, channels).mean(axis=1).astype(float) / 32768
    sound = parselmouth.Sound(values, sampling_frequency=rate)
    samples = sound.values.mean(axis=0)
    tracks = {}
    for method in ("ac", "cc"):
        for floor in (70, 100, 130):
            pitch = getattr(sound, "to_pitch_" + method)(
                time_step=0.005, pitch_floor=floor, pitch_ceiling=600,
                voicing_threshold=0.5,
            )
            times = pitch.xs()
            frequency = pitch.selected_array["frequency"].copy()
            # Exclude very weak tails; do not interpolate across unvoiced gaps.
            rms = np.array([np.sqrt(np.mean(samples[max(0, int((t-.01)*sound.sampling_frequency)):min(len(samples), int((t+.01)*sound.sampling_frequency))] ** 2)) for t in times])
            mask = (frequency > 0) & (rms > max(rms.max() * 10 ** (-35 / 20), 1e-6))
            frequency[~mask] = np.nan
            tracks[f"{method}{floor}"] = {"t": times, "f": frequency, "groups": spans(times, mask)}

    base = tracks["ac70"]
    groups = base["groups"]
    if not groups:
        raise ValueError(f"No usable voicing: {file}")
    # /x/ in shun-xu is unvoiced. Its measured voicing gap separates the final vowel.
    # For monosyllables include every voiced portion, including creaky interruptions.
    interval = groups[-1] if "顺序" in file else (groups[0][0], groups[-1][1])
    summaries = {}
    for key, track in tracks.items():
        chosen = (track["t"] >= interval[0]) & (track["t"] <= interval[1]) & np.isfinite(track["f"])
        t, f = track["t"][chosen], track["f"][chosen]
        if len(f) < 8:
            continue
        u = (t - interval[0]) / (interval[1] - interval[0])
        first = f[u <= .2]
        last = f[u >= .8]
        if not len(first) or not len(last):
            continue
        start, end = float(np.median(first)), float(np.median(last))
        bins = [float(np.median(f[(u >= lo) & (u < lo + .1)])) if np.any((u >= lo) & (u < lo + .1)) else None for lo in np.arange(0, 1, .1)]
        summaries[key] = {"start_hz": round(start, 1), "end_hz": round(end, 1),
                          "change_semitones": round(float(12*np.log2(end/start)), 2),
                          "voiced_frames": len(f), "bin_medians_hz": bins}
    possible_octave_jump = "ac70" in summaries and "cc70" in summaries and abs(np.log2(summaries["ac70"]["end_hz"] / summaries["cc70"]["end_hz"])) > .5
    row = {"file": file, "label": label, "duration_ms": round(sound.duration*1000, 1),
           "source_sha256": hashlib.sha256(blob).hexdigest(), "pcm_sha256": hashlib.sha256(pcm).hexdigest(),
           "voiced_groups_s": groups, "analysis_interval_s": interval,
           "voiced_interval_ms": round((interval[1]-interval[0])*1000, 1),
           "readings": summaries, "ac70_possible_octave_error": bool(possible_octave_jump),
           "tone_label_automatically_verified": False}
    return row, sound, tracks


results = [analyze(*item) for item in FILES]
report = {"tool": f"Parselmouth {parselmouth.VERSION} / Praat {parselmouth.PRAAT_VERSION}",
          "methods": "raw autocorrelation and raw cross-correlation; 5 ms step; floors 70/100/130 Hz; ceiling 600 Hz; voicing threshold 0.5; energy gate -35 dB relative to peak",
          "limits": "F0 estimates can have octave/voicing errors. Voiced intervals are algorithmic, not forced phoneme alignment. No categorical tone classifier or native-listener certification. Streamed WAV placeholder lengths are bounded to actual PCM bytes. Listening copies repair only WAV size headers; PCM is byte-identical, with no trimming, speed or pitch changes.",
          "tracker_note": ("Diction controls compare default, explicit pinyin, rate 1.25, and both. CC70 summaries are printed; all six trackers are retained. Duration changes are measured, not pronunciation certification." if DICTION else "The original word sample has an AC70-only terminal octave jump; CC and AC at 100/130 Hz floors continue falling. The normalized comparison and table use CC70, with all six results retained in JSON."),
          "files": [r[0] for r in results]}
(OUT / "measurements.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
if DICTION:
    for row, _, _ in results:
        reading = row["readings"].get("cc70", {})
        print(json.dumps({"file": row["file"], "duration_ms": row["duration_ms"],
                          "voiced_interval_ms": row["voiced_interval_ms"],
                          "start_hz": reading.get("start_hz"), "end_hz": reading.get("end_hz"),
                          "pcm_sha256": row["pcm_sha256"]}, ensure_ascii=True))
    sys.exit(0)

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
fig, axes = plt.subplots(3, 2, figsize=(12, 9), constrained_layout=True)
for col, (row, sound, tracks) in enumerate(results[:2]):
    time = sound.xs()
    samples = sound.values[0]
    axes[0, col].plot(time, samples, color="#697d8b", linewidth=.6)
    axes[0, col].axvspan(*row["analysis_interval_s"], color="#d57b28", alpha=.16)
    axes[0, col].set(title=row["label"], ylabel="Amplitude", xlim=(0, sound.duration))
    f, t, power = spectrogram(samples, sound.sampling_frequency, nperseg=768, noverlap=624)
    axes[1, col].pcolormesh(t, f, 10*np.log10(power + 1e-12), cmap="Greys", shading="auto", vmin=-100, vmax=-35)
    axes[1, col].axvspan(*row["analysis_interval_s"], color="#d57b28", alpha=.15)
    axes[1, col].set(ylabel="Frequency (Hz)", ylim=(0, 5000), xlim=(0, sound.duration))
    for key, color in (("ac70", "#236b8e"), ("cc70", "#c65f20")):
        track = tracks[key]
        axes[2, col].plot(track["t"], track["f"], ".-", markersize=3, linewidth=1, color=color, label=key)
    axes[2, col].axvspan(*row["analysis_interval_s"], color="#d57b28", alpha=.12)
    axes[2, col].set(xlabel="Time (s)", ylabel="Estimated F0 (Hz)", ylim=(60, 450), xlim=(0, sound.duration))
    axes[2, col].legend(loc="upper right")
    if row["ac70_possible_octave_error"]:
        axes[2, col].text(.32, 385, "AC70-only octave jump at tail\nCC and other floors stay low", fontsize=8, color="#8a3c13")
fig.suptitle("Zhijia: isolated xu4 versus the final vowel of shun4 xu4\nOriginal 0.9 synthesis-rate samples; shaded interval is measured voicing, not an audio crop", fontsize=13)
fig.savefig(OUT / "original-comparison.png", dpi=160)
fig.savefig(OUT / "original-comparison.svg")
plt.close(fig)

fig, axes = plt.subplots(1, 2, figsize=(12, 5.4), constrained_layout=True)
for i in (0, 1, 2, 3):
    row, _, tracks = results[i]
    a, b = row["analysis_interval_s"]
    track = tracks["cc70"]
    mask = (track["t"] >= a) & (track["t"] <= b)
    axes[0].plot((track["t"][mask]-a)/(b-a)*100, track["f"][mask], ".-", markersize=3, label=row["label"])
for i in (6, 7, 8, 2, 9):
    row, _, tracks = results[i]
    a, b = row["analysis_interval_s"]
    track = tracks["cc70"]
    mask = (track["t"] >= a) & (track["t"] <= b)
    axes[1].plot((track["t"][mask]-a)/(b-a)*100, track["f"][mask], ".-", markersize=3, label=row["label"])
for ax in axes:
    ax.set(xlabel="Measured vowel interval (%)", ylabel="Estimated F0 (Hz)", ylim=(60, 450))
    ax.grid(alpha=.2)
    ax.legend(fontsize=8, loc="upper center", bbox_to_anchor=(.5, -.18), ncol=2)
axes[0].set_title("CC70: isolated / word-final xu4 and synthesis rate")
axes[1].set_title("CC70: lexical-tone controls at normal synthesis rate")
fig.savefig(OUT / "contour-controls.png", dpi=160)
fig.savefig(OUT / "contour-controls.svg")
plt.close(fig)

rows = []
for row, _, _ in results:
    s = row["readings"].get("cc70", {})
    rows.append(f'<tr><td>{html.escape(row["label"])}</td><td>{row["duration_ms"]}</td><td>{row["voiced_interval_ms"]}</td><td>{s.get("start_hz")}</td><td>{s.get("end_hz")}</td><td><audio controls preload="none" src="audio/{html.escape(row["file"])}"></audio></td></tr>')
(OUT / "index.html").write_text(f'''<!doctype html><meta charset="utf-8"><title>Zhijia pitch measurements</title>
<style>body{{font:16px system-ui;max-width:1250px;margin:24px auto;padding:12px}}img{{width:100%}}td,th{{padding:10px;border-bottom:1px solid #ddd;text-align:left}}audio{{width:220px}}table{{border-collapse:collapse}}</style>
<h1>Zhijia: 序 versus 顺序</h1><p>{html.escape(report["tool"])}. {html.escape(report["methods"])}.</p>
<p>{html.escape(report["limits"])}</p><p>{html.escape(report["tracker_note"])}</p><p>Start/end Hz are medians of the first/last 20% of the estimated final voiced vowel. They are not exact syllable boundaries. Normalized time is for plotting only; audio is unchanged.</p>
<img src="original-comparison.svg"><img src="contour-controls.svg">
<table><tr><th>Fixture</th><th>File ms</th><th>Voiced span ms</th><th>Start Hz</th><th>End Hz</th><th>Original audio</th></tr>{"".join(rows)}</table>
<p><a href="measurements.json">Full measurements and sensitivity checks</a></p>''', encoding="utf-8")
for row, _, _ in results:
    print(json.dumps({k: row[k] for k in ("file", "duration_ms", "voiced_interval_ms")} | {"ac70": row["readings"].get("ac70"), "cc70": row["readings"].get("cc70")}, ensure_ascii=True))
