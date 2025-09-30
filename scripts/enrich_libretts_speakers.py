#!/usr/bin/env python3
import argparse, json, glob, re, hashlib
import pandas as pd
import numpy as np
from collections import Counter, defaultdict

CSV_CANON = {
    "speaker_id": ["speaker_id","spk","speaker","sid"],
    "gender": ["gender","sex"],
    "accent": ["accent","region"],
    "subset": ["subset","split","dataset"],
    "pitch_mean": ["pitch_mean","f0_mean","mean_pitch_hz"],
    "speaking_rate": ["speaking_rate","wpm","words_per_min"],
    "brightness": ["brightness"],
    "duration_s": ["duration_s","dur_s","duration","secs"],
}

def pick_col(df, candidates):
    cols = {c.lower(): c for c in df.columns}
    for name in candidates:
        if name.lower() in cols:
            return cols[name.lower()]
    return None

def load_csvs(folder):
    paths = sorted(glob.glob(f"{folder}/df*.csv"))
    if not paths:
        raise RuntimeError("No df*.csv files found.")
    dfs = [pd.read_csv(p) for p in paths]
    return pd.concat(dfs, ignore_index=True)

def aggregate(df):
    # resolve columns
    col_id = pick_col(df, CSV_CANON["speaker_id"])
    if not col_id:
        raise RuntimeError("No speaker_id column found in CSVs")

    col_gender   = pick_col(df, CSV_CANON["gender"])
    col_accent   = pick_col(df, CSV_CANON["accent"])
    col_subset   = pick_col(df, CSV_CANON["subset"])
    col_pitch    = pick_col(df, CSV_CANON["pitch_mean"])
    col_rate     = pick_col(df, CSV_CANON["speaking_rate"])
    col_bright   = pick_col(df, CSV_CANON["brightness"])
    col_dur      = pick_col(df, CSV_CANON["duration_s"])

    # normalize types
    df[col_id] = df[col_id].astype(str)

    def mode_or_first(s):
        try: return s.mode(dropna=True).iloc[0]
        except: return s.dropna().iloc[0] if len(s.dropna()) else None

    def wmean(vals, weights):
        import numpy as np
        v = vals.astype(float)
        w = weights.astype(float)
        return float((v*w).sum() / max(w.sum(), 1.0))

    agg = {}
    if col_gender: agg[col_gender] = mode_or_first
    if col_accent: agg[col_accent] = mode_or_first
    if col_subset: agg[col_subset] = mode_or_first
    if col_pitch:
        agg[col_pitch] = (lambda s: wmean(s, df.loc[s.index, col_dur])) if col_dur else "mean"
    if col_rate:
        agg[col_rate] = (lambda s: wmean(s, df.loc[s.index, col_dur])) if col_dur else "mean"
    if col_bright:
        agg[col_bright] = (lambda s: wmean(s, df.loc[s.index, col_dur])) if col_dur else "mean"

    grouped = df.groupby(col_id).agg(agg).reset_index()

    # rekey
    out = {}
    for _, row in grouped.iterrows():
        sid = str(row[col_id])
        out[sid] = {
            "speaker_id": sid,
            "gender": row.get(col_gender),
            "accent": row.get(col_accent),
            "subset": row.get(col_subset),
            "pitch_mean": float(row[col_pitch]) if col_pitch and pd.notna(row[col_pitch]) else None,
            "speaking_rate": float(row[col_rate]) if col_rate and pd.notna(row[col_rate]) else None,
            "brightness": float(row[col_bright]) if col_bright and pd.notna(row[col_bright]) else None,
        }
    return out

def build_facets(speakers):
    counters = defaultdict(Counter)
    mins, maxs = {}, {}
    for sp in speakers.values():
        counters["gender"][sp.get("gender","U")] += 1
        counters["accent"][sp.get("accent","Unknown")] += 1
        counters["subset"][sp.get("subset","Unknown")] += 1
        for k in ("pitch_mean","speaking_rate","brightness"):
            v = sp.get(k)
            if v is None: continue
            mins[k] = v if k not in mins else min(mins[k], v)
            maxs[k] = v if k not in maxs else max(maxs[k], v)

    def pack(counter):
        return [{"value": k, "count": v} for k,v in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))]

    sliders = []
    for key,label,units in [("pitch_mean","Pitch","Hz"),("speaking_rate","Rate","wpm"),("brightness","Brightness",None)]:
        sliders.append({"key":key,"label":label,"units":units,"min":mins.get(key),"max":maxs.get(key)})

    return {"gender":{"values":pack(counters["gender"])},
            "accent":{"values":pack(counters["accent"])},
            "subset":{"values":pack(counters["subset"])},
            "sliders":sliders}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voices", required=True)
    ap.add_argument("--csv-folder", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--variant-key", default="en_US-libritts_r-medium")
    args = ap.parse_args()

    with open(args.voices,"r",encoding="utf-8") as f:
        voices = json.load(f)

    df = load_csvs(args.csv_folder)
    meta = aggregate(df)

    block = voices[args.variant_key]
    speakers_list = []
    for sid, idx in block["speaker_id_map"].items():
        m = meta.get(str(sid), {})
        speakers_list.append({
            "speaker_id": str(sid),
            "index": idx,
            **m
        })
    speakers_list.sort(key=lambda s: s["index"])
    block["speakers"] = speakers_list
    block["facets"] = build_facets(meta)
    voices[args.variant_key] = block

    with open(args.out,"w",encoding="utf-8") as f:
        json.dump(voices,f,ensure_ascii=False,indent=2)

    print(f"Enriched voices written to {args.out}")

if __name__ == "__main__":
    main()

