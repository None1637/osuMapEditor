using System.Text.Json;
using System.Text.Json.Nodes;
using ManagedBass;
using ManagedBass.Fx;

// v599: lazer 同源 BASS FX Tempo 侧车。渲染进程只发 JSON 行命令, 音乐由原生 BASS 解码/拉伸/输出。
internal static class Program
{
    private static int stream;
    private static bool playing;
    private static readonly object sync = new();

    private static void Send(object value)
    {
        Console.WriteLine(JsonSerializer.Serialize(value));
        Console.Out.Flush();
    }

    private static void FreeStream()
    {
        playing = false;
        if (stream != 0)
        {
            Bass.ChannelStop(stream);
            Bass.StreamFree(stream);
            stream = 0;
        }
    }

    private static void Play(JsonObject cmd)
    {
        lock (sync)
        {
            FreeStream();
            var file = cmd["path"]!.GetValue<string>();
            var requestId = cmd["requestId"]?.GetValue<int>() ?? 0;
            var rate = cmd["rate"]?.GetValue<double>() ?? 1;
            var volume = cmd["volume"]?.GetValue<double>() ?? 1;
            var offset = cmd["offset"]?.GetValue<double>() ?? 0;
            try
            {
                var decode = Bass.CreateStream(file, 0, 0, BassFlags.Decode | BassFlags.Unicode);
                if (decode == 0) throw new InvalidOperationException($"BASS.CreateStream: {Bass.LastError}; exists={File.Exists(file)}; path={file}");
                stream = BassFx.TempoCreate(decode, BassFlags.Decode | BassFlags.FxFreeSource);
                if (stream == 0) throw new InvalidOperationException($"BASS_FX_TempoCreate: {Bass.LastError}");
                // v602: 反编译 lazer TrackBass.prepareStream 的实际 Tempo 参数, 不再使用 BASS 默认值
                Bass.ChannelSetAttribute(stream, ChannelAttribute.TempoUseQuickAlgorithm, 1);
                Bass.ChannelSetAttribute(stream, ChannelAttribute.TempoOverlapMilliseconds, 4);
                Bass.ChannelSetAttribute(stream, ChannelAttribute.TempoSequenceMilliseconds, 30);
                Bass.ChannelSetAttribute(stream, (ChannelAttribute)65559, 1);
                // lazer PlaybackControl → AdjustableProperty.Tempo: BASS_ATTRIB_TEMPO 为相对百分比, 音高不变。
                if (!Bass.ChannelSetAttribute(stream, ChannelAttribute.Tempo, (rate - 1) * 100))
                    throw new InvalidOperationException($"BASS_ATTRIB_TEMPO: {Bass.LastError}");
                Bass.ChannelSetAttribute(stream, ChannelAttribute.Volume, volume);
                if (offset > 0 && !Bass.ChannelSetPosition(stream, Bass.ChannelSeconds2Bytes(stream, offset), PositionFlags.Bytes))
                    throw new InvalidOperationException($"BASS.ChannelSetPosition: {Bass.LastError}");
                if (!Bass.ChannelPlay(stream, false)) throw new InvalidOperationException($"BASS.ChannelPlay: {Bass.LastError}");
                playing = true;
                Send(new { type = "play-ack", requestId, ok = true, rate });
            }
            catch (Exception ex)
            {
                FreeStream();
                Send(new { type = "play-ack", requestId, ok = false, error = ex.Message });
            }
        }
    }

    public static void Main()
    {
        Console.InputEncoding = new System.Text.UTF8Encoding(false);
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        Environment.CurrentDirectory = Path.Combine(AppContext.BaseDirectory, "lib");
        if (!Bass.Init(-1, 48000, DeviceInitFlags.Default, IntPtr.Zero))
        {
            Send(new { type = "init-error", error = $"BASS.Init: {Bass.LastError}" });
            return;
        }
        Send(new { type = "ready" });
        try
        {
            while (Console.ReadLine() is { } line)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var cmd = JsonNode.Parse(line)!.AsObject();
                var type = cmd["type"]?.GetValue<string>();
                lock (sync)
                {
                    switch (type)
                    {
                        case "play": Play(cmd); break;
                        case "stop": FreeStream(); Send(new { type = "stop-ack" }); break;
                        case "volume":
                            if (stream != 0) Bass.ChannelSetAttribute(stream, ChannelAttribute.Volume, cmd["volume"]!.GetValue<double>());
                            break;
                        case "position":
                            Send(new { type = "position", playing, seconds = stream == 0 ? 0 : Bass.ChannelBytes2Seconds(stream, Bass.ChannelGetPosition(stream, PositionFlags.Bytes)) });
                            break;
                        case "shutdown": FreeStream(); return;
                    }
                }
            }
        }
        finally
        {
            FreeStream();
            Bass.Free();
        }
    }
}
