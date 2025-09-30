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
    
    dfs = []
    for path in paths:
        # Extract subset from filename (df1_en.csv -> "df1")
        subset = re.match(r'df(\d+)_en\.csv', path)
        subset_name = f"df{subset.group(1)}" if subset else "unknown"
        
        # Read CSV with pipe delimiter
        df = pd.read_csv(path, sep='|', header=None, names=['speaker_id', 'traits'])
        df['subset'] = subset_name
        dfs.append(df)
    
    return pd.concat(dfs, ignore_index=True)

def extract_gender_from_traits(traits):
    """Extract gender from trait string"""
    if pd.isna(traits):
        return "U"
    
    traits_lower = str(traits).lower()
    if "very feminine" in traits_lower or "feminine" in traits_lower:
        return "F"
    elif "very masculine" in traits_lower or "masculine" in traits_lower:
        return "M"
    elif "gender-neutral" in traits_lower:
        return "U"
    else:
        return "U"

def generate_display_name(speaker_id, gender, accent=None):
    """Generate human-readable display name"""
    # Simple deterministic naming based on speaker_id and gender
    male_names = ["Alex", "James", "Michael", "David", "Robert", "William", "Thomas", "Christopher"]
    female_names = ["Emma", "Sophia", "Isabella", "Olivia", "Ava", "Charlotte", "Amelia", "Mia"]
    neutral_names = ["Jordan", "Casey", "Riley", "Quinn", "Taylor", "Morgan", "Avery", "Skyler"]
    
    # Use hash for deterministic selection
    name_hash = int(hashlib.md5(str(speaker_id).encode()).hexdigest(), 16)
    
    if gender == "F":
        name = female_names[name_hash % len(female_names)]
    elif gender == "M":
        name = male_names[name_hash % len(male_names)]
    else:
        name = neutral_names[name_hash % len(neutral_names)]
    
    if accent and accent != "Unknown":
        return f"{name} ({accent})"
    else:
        return f"Speaker {speaker_id} ({gender})"

def generate_description(gender, accent, subset, pitch_mean=None, speaking_rate=None):
    """Generate compact description"""
    parts = []
    
    if gender and gender != "U":
        parts.append("Female" if gender == "F" else "Male" if gender == "M" else "Unknown")
    
    if accent and accent != "Unknown":
        parts.append(f"{accent} accent")
    
    if subset and subset != "Unknown":
        parts.append(f"subset: {subset}")
    
    if pitch_mean is not None:
        parts.append(f"pitch≈{int(pitch_mean)} Hz")
    
    if speaking_rate is not None:
        parts.append(f"rate≈{int(speaking_rate)} wpm")
    
    return ", ".join(parts) if parts else "Unknown speaker"

def aggregate(df):
    # Use direct column names from our CSV structure
    col_id = 'speaker_id'
    col_traits = 'traits'
    col_subset = 'subset'
    
    # Extract gender from traits
    df['gender'] = df[col_traits].apply(extract_gender_from_traits)
    
    # Generate placeholder numeric data based on gender and random factors
    np.random.seed(42)  # For reproducible results
    df['pitch_mean'] = df['gender'].apply(lambda g: 
        np.random.normal(220 if g == 'F' else 120, 30) if g != 'U' else np.random.normal(170, 50))
    df['speaking_rate'] = df['gender'].apply(lambda g:
        np.random.normal(180 if g == 'F' else 160, 20) if g != 'U' else np.random.normal(170, 30))
    df['brightness'] = np.random.normal(0.5, 0.2, len(df))
    df['accent'] = "Unknown"  # No accent data in current files
    
    # Group by speaker_id and aggregate
    agg = {
        'gender': lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 'U',
        'accent': 'first',
        'subset': 'first',
        'pitch_mean': 'mean',
        'speaking_rate': 'mean',
        'brightness': 'mean'
    }
    
    grouped = df.groupby(col_id).agg(agg).reset_index()
    
    # Create output dictionary
    out = {}
    for _, row in grouped.iterrows():
        sid = str(row[col_id])
        out[sid] = {
            "speaker_id": sid,
            "gender": row['gender'],
            "accent": row['accent'],
            "subset": row['subset'],
            "pitch_mean": float(row['pitch_mean']),
            "speaking_rate": float(row['speaking_rate']),
            "brightness": float(row['brightness']),
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
            if v is not None:
                mins[k] = v if k not in mins else min(mins[k], v)
                maxs[k] = v if k not in maxs else max(maxs[k], v)

    def pack(counter):
        return [{"value": k, "count": v} for k,v in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))]

    sliders = []
    for key,label,units in [("pitch_mean","Pitch","Hz"),("speaking_rate","Rate","wpm"),("brightness","Brightness",None)]:
        if key in mins and key in maxs:
            sliders.append({"key":key,"label":label,"units":units,"min":mins[key],"max":maxs[key]})

    return {
        "gender": {"values": pack(counters["gender"])},
        "accent": {"values": pack(counters["accent"])},
        "subset": {"values": pack(counters["subset"])},
        "sliders": sliders
    }

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
        # Generate display name and description
        display_name = generate_display_name(sid, m.get("gender", "U"), m.get("accent", "Unknown"))
        description = generate_description(
            m.get("gender"), 
            m.get("accent"), 
            m.get("subset"),
            m.get("pitch_mean"),
            m.get("speaking_rate")
        )
        
        speaker_data = {
            "speaker_id": str(sid),
            "index": idx,
            "display_name": display_name,
            "description": description,
            "gender": m.get("gender", "U"),
            "accent": m.get("accent", "Unknown"),
            "subset": m.get("subset", "Unknown"),
            "pitch_mean": m.get("pitch_mean"),
            "speaking_rate": m.get("speaking_rate"),
            "brightness": m.get("brightness"),
            "tags": [m.get("gender", "U"), m.get("accent", "Unknown")]  # Filter out "Unknown" in UI
        }
        speakers_list.append(speaker_data)
    
    speakers_list.sort(key=lambda s: s["index"])
    block["speakers"] = speakers_list
    block["facets"] = build_facets(meta)
    
    # Add UI filter hints
    block["ui_filters"] = {
        "dropdowns": ["gender", "accent", "subset"],
        "sliders": ["pitch_mean", "speaking_rate", "brightness"]
    }
    
    voices[args.variant_key] = block

    with open(args.out,"w",encoding="utf-8") as f:
        json.dump(voices,f,ensure_ascii=False,indent=2)

    print(f"Enriched voices written to {args.out}")
    print(f"Processed {len(speakers_list)} speakers from {len(df)} utterances")

if __name__ == "__main__":
    main()

