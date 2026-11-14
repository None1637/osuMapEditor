# v574: 将用户指定的18张谱面复制进工作区，仅从谱面副本解析并复制对应音频。
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCES = [
    r"F:\Backup\D\osu!\Songs\beatmap-637326486493994115-Kanoguti - Fantastic Polygon\Kanoguti - Fantastic Polygon (None1637) [DeathJump].osu",
    r"F:\Backup\D\osu!\Songs\Chroma - sink to the deep sea world\Chroma - sink to the deep sea world (None1637) [D].osu",
    r"F:\Backup\D\osu!\Songs\Crystalia\DJ TOTTO - Crystalia (None1637) [Extra 2018].osu",
    r"F:\Backup\D\osu!\Songs\Ethnica - For You the Bellz Toll\Yanagida Ethnica - For You the Bellz Toll (None1637) [EX].osu",
    r"F:\Backup\D\osu!\Songs\beatmap-638723741774347324-audio\Akatsuki Records - VENTEN (None1637) [EX].osu",
    r"F:\Backup\D\osu!\Songs\beatmap-637123692701975954-uma vs. Morimori Atsushi - FIRST DREAMS\uma vs. Morimori Atsushi - FIRSTDREAMS (None1637) [ULTRA].osu",
    r"F:\Backup\D\osu!\Songs\beatmap-637257232400584039-Xronial Xero\Camellia as menaXe InXonnu - Xronial Xero (None1637) [EX].osu",
    r"F:\Backup\D\osu!\Songs\Kobaryo - Soylentize\Kobaryo - Soylentize (None1637) [EX].osu",
    r"F:\Backup\D\osu!\Songs\Uraomote Lovers\Hatsune Miku - Uraomote Lovers (None1637) [Extra].osu",
    r"F:\Backup\D\osu!\Songs\Nikolai Rimsky-Korsakov - The Flight Of The Bumble Bee\Nikolai Rimsky-Korsakov - The Flight Of The Bumble Bee (None1637) [Stream].osu",
    r"F:\Backup\D\osu!\Songs\四面の箏の為の「平安のエイリアン」_外柿山\Togakisan - For the four kotos[Heian Alien] (None1637) [DeathStream].osu",
    r"F:\Backup\D\osu!\Songs\2062752 yukikaze - R31 L0V3 C0R3\yukikaze - R31 L0V3 C0R3 (oTwinkle) [Phantasmagorical].osu",
    r"F:\Backup\D\osu!\Songs\1783959 Kobaryo - northern_limit [feat Sennzai]\Kobaryo - northern_limit [feat. Sennzai] (Snow Note) [limit_braeker.exe].osu",
    r"F:\Backup\D\osu!\Songs\793089 Umarutufuri - Amakaze no Matsuri\Umarutufuri - Amakaze no Matsuri (Snow Note) [Matsuri].osu",
    r"F:\Backup\D\osu!\Songs\1480822 P4koo - Enka - flameflower -\P4koo - Enka - flameflower - (Snow Note) [Fatal].osu",
    r"F:\Backup\D\osu!\Songs\2513884 you are an angel - overture\you are an angel - overture (NaPiii_) [Daydream].osu",
    r"F:\Backup\D\osu!\Songs\2638375 Rainie Yang - Yu Ai\Rainie Yang - Yu Ai (Sakuraba Ruri) [smrt's Ever-changing Hard].osu",
    r"F:\Backup\D\osu!\Songs\beatmap-637586920562929759-Camellia - 64bits 32bits 16bits 8bits but remixed by Camellia\Camellia - 64bits 32bits 16bits 8bits but remixed by Camellia (None1637) [XD].osu",
]
TAGS = {
    "case-017": "user_requested_low_bpm",
    "case-018": "user_requested_extreme_high_and_low_bpm_variable",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def audio_filename(beatmap_path: Path) -> str:
    in_general = False
    for raw in beatmap_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line.startswith("[") and line.endswith("]"):
            in_general = line == "[General]"
            continue
        if in_general and line.lower().startswith("audiofilename:"):
            value = line.split(":", 1)[1].strip()
            if not value:
                raise ValueError(f"空AudioFilename: {beatmap_path}")
            return value
    raise ValueError(f"缺少AudioFilename: {beatmap_path}")


def object_times(beatmap_path: Path) -> list[int]:
    text = beatmap_path.read_text(encoding="utf-8-sig")
    section = text.split("[HitObjects]", 1)[1].split("[", 1)[0]
    times = [round(float(row.split(",")[2])) for row in section.splitlines() if row.strip()]
    if not times:
        raise ValueError(f"没有HitObjects: {beatmap_path}")
    return times


if (ROOT / "source-manifest.json").exists():
    raise FileExistsError("v574清单已存在；为避免覆盖冻结样本，本次ingest停止")
records = []
for index, source_text in enumerate(SOURCES, start=1):
    case_id = f"case-{index:03d}"
    source = Path(source_text)
    case_dir = ROOT / "samples" / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    beatmap_copy = case_dir / source.name
    shutil.copy2(source, beatmap_copy)
    # 从此处开始只读取工作区谱面副本；原谱面不再作为分析输入。
    audio_name = audio_filename(beatmap_copy)
    audio_source = source.parent / audio_name
    audio_copy = case_dir / audio_name
    shutil.copy2(audio_source, audio_copy)
    times = object_times(beatmap_copy)
    records.append({
        "id": case_id,
        "tag": TAGS.get(case_id, "user_requested"),
        "sourceBeatmapPath": source_text,
        "sourceAudioPath": str(audio_source),
        "workspaceBeatmapPath": str(beatmap_copy),
        "workspaceAudioPath": str(audio_copy),
        "beatmapSha256": sha256(beatmap_copy),
        "audioSha256": sha256(audio_copy),
        "audioFilename": audio_name,
        "objectCountIncludingSimultaneousObjects": len(times),
        "uniqueObjectTimeCount": len(set(times)),
        "firstObjectMs": min(times),
        "lastObjectMs": max(times),
    })
    print(json.dumps({"id": case_id, "objects": len(times), "uniqueTimes": len(set(times)), "audio": audio_name}, ensure_ascii=False))
manifest = {
    "version": "v574-user-supplied-high-quality-offset-benchmark-v1",
    "source": "18 beatmaps explicitly supplied by the owner on 2026-11-12; all files copied into workspace before analysis",
    "referenceAssertion": "Owner states that every selected beatmap has more than 90% correct object offsets; this is owner-provided reference metadata, not independently re-annotated by the agent",
    "referenceRule": "Every HitObjects row start time, including simultaneous objects; slider/spinner start only; no visual onset labels and no no_clear exclusions",
    "samples": records,
}
(ROOT / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
config = {
    "version": "v574-user-benchmark-frozen-baseline-v1",
    "status": "frozen_before_baseline_evaluation",
    "sampleIds": [record["id"] for record in records],
    "sampleCount": 18,
    "objectCount": sum(record["objectCountIncludingSimultaneousObjects"] for record in records),
    "toleranceMs": 5.0,
    "targetCorrectRate": 0.8,
    "primaryMetric": "Micro-weighted fraction of all HitObjects rows whose absolute candidate onset time is within +/-5 ms of the beatmap object start time; missing candidates incorrect",
    "aggregation": "All objects across all 18 maps pooled; per-map and special-tag results descriptive",
    "referenceLimit": "Beatmap offsets are owner-certified >90% accurate rather than exact acoustic annotations; the 80% target leaves margin but does not prove every residual is algorithm error",
    "productionCodeChanged": False,
    "resultPolicy": "Run the frozen current detector baseline before changing parameters; report failures literally and do not remove difficult objects",
}
(ROOT / "experiment.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"V574_INGEST_WRITTEN samples={len(records)} objects={config['objectCount']}")
