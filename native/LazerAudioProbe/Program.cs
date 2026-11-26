using System.Reflection;
using ManagedBass;
using ManagedBass.Fx;
using osu.Framework.Audio;
using osu.Framework.Audio.Track;
using osu.Framework.Audio.Mixing;
using osu.Framework.Bindables;

// v602: 直接实例化 lazer TrackBass, 与本项目直调 BASS 的 0.25x 输出做样本对照
static byte[] Wav()
{
    const int sr = 48000, frames = sr;
    using var ms = new MemoryStream();
    using var w = new BinaryWriter(ms);
    w.Write("RIFF"u8.ToArray()); w.Write(36 + frames * 2); w.Write("WAVEfmt "u8.ToArray());
    w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(sr); w.Write(sr * 2); w.Write((short)2); w.Write((short)16);
    w.Write("data"u8.ToArray()); w.Write(frames * 2);
    uint noise = 123456789;
    for (int i = 0; i < frames; i++)
    {
        noise = noise * 1664525 + 1013904223;
        var v = 0.32 * Math.Sin(i * 2 * Math.PI * 440 / sr)
              + 0.24 * Math.Sin(i * 2 * Math.PI * 1000 / sr)
              + 0.18 * Math.Sin(i * 2 * Math.PI * 5000 / sr)
              + 0.08 * ((noise / (double)uint.MaxValue) * 2 - 1)
              + (i == 12000 ? 0.65 : 0);
        w.Write((short)Math.Clamp(Math.Round(v * 24000), short.MinValue, short.MaxValue));
    }
    return ms.ToArray();
}

static float[] ReadAll(int stream)
{
    var all = new List<float>();
    var buf = new float[8192];
    while (true)
    {
        var got = Bass.ChannelGetData(stream, buf, buf.Length * sizeof(float));
        if (got <= 0) break;
        all.AddRange(buf.Take(got / sizeof(float)));
    }
    return all.ToArray();
}

Environment.CurrentDirectory = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "BassAudioSidecar", "lib");
if (!Bass.Init(-1, 48000, DeviceInitFlags.Default, IntPtr.Zero)) throw new Exception($"Bass.Init: {Bass.LastError}");
var wav = Wav();
var wavPath = Path.Combine(AppContext.BaseDirectory, "probe.wav");
File.WriteAllBytes(wavPath, wav);

Console.WriteLine("before adjustments");
var adjustments = new AudioAdjustments();
var tempo = new BindableDouble(0.25);
adjustments.AddAdjustment(AdjustableProperty.Tempo, tempo);
Console.WriteLine("before TrackBass");
var track = (TrackBass)Activator.CreateInstance(typeof(TrackBass), BindingFlags.NonPublic | BindingFlags.Instance, null, new object[] { new MemoryStream(wav), "probe", false }, null)!;
var mixerType = typeof(TrackBass).Assembly.GetType("osu.Framework.Audio.Mixing.Bass.BassAudioMixer")!;
var mixerCtor = mixerType.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance).Single(c => c.GetParameters().Length == 3);
var mixer = (AudioMixer)mixerCtor.Invoke(new object?[] { null, null, "probe" });
typeof(TrackBass).GetProperty("Mixer", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance)!.SetValue(track, mixer);
Console.WriteLine("before BindAdjustments");
track.BindAdjustments(adjustments);
track.Update();
mixer.Update();
for (var i = 0; i < 500 && !track.IsLoaded; i++) { Thread.Sleep(10); track.Update(); mixer.Update(); }
Console.WriteLine($"IsLoaded={track.IsLoaded}");
Console.WriteLine("before field");
var field = typeof(TrackBass).GetField("tempoAdjustStream", BindingFlags.NonPublic | BindingFlags.Instance)!;
var lazerStream = (int)field.GetValue(track)!;
Console.WriteLine($"lazer stream={lazerStream}");
var lazer = ReadAll(lazerStream);

var decode = Bass.CreateStream(wavPath, 0, 0, BassFlags.Decode);
var oursStream = BassFx.TempoCreate(decode, BassFlags.Decode | BassFlags.FxFreeSource);
Bass.ChannelSetAttribute(oursStream, ChannelAttribute.Tempo, -75);
Bass.ChannelSetAttribute(oursStream, ChannelAttribute.TempoUseQuickAlgorithm, 1);
Bass.ChannelSetAttribute(oursStream, ChannelAttribute.TempoOverlapMilliseconds, 4);
Bass.ChannelSetAttribute(oursStream, ChannelAttribute.TempoSequenceMilliseconds, 30);
Bass.ChannelSetAttribute(oursStream, (ChannelAttribute)65559, 1);
var ours = ReadAll(oursStream);
Console.WriteLine($"samples lazer={lazer.Length} ours={ours.Length}");
Console.WriteLine($"first lazer={string.Join(',', lazer.Take(4))} ours={string.Join(',', ours.Take(4))}");
var n = Math.Min(lazer.Length, ours.Length);
double max = 0, sum = 0;
long different = 0, nan = 0;
for (int i = 0; i < n; i++)
{
    if (float.IsNaN(lazer[i]) || float.IsNaN(ours[i])) { nan++; continue; }
    var d = Math.Abs(lazer[i] - ours[i]);
    if (d > 1e-7) different++;
    max = Math.Max(max, d); sum += d * d;
}
Console.WriteLine($"different={different}/{n} nan={nan} maxAbs={max:R} rms={Math.Sqrt(sum / Math.Max(1, n - nan)):R}");
Bass.Free();
