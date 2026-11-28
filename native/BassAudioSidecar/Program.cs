using System.Text.Json;
using System.Text.Json.Nodes;
using ManagedBass;
using ManagedBass.Fx;

// v599: lazer 同源 BASS FX Tempo 侧车。渲染进程只发 JSON 行命令, 音乐由原生 BASS 解码/拉伸/输出。
internal static class Program
{
    private static int stream;
    private static bool playing;
    private static int currentRequestId;
    private static double currentRate = 1;
    private static double deviceLatencyMs;
    private static long lastBufferSampleMs = -1000;
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

    // v620: 同一位置采样点的实际待播放时长 (谱面 ms), 仅起播和每秒校准调用
    private static double PendingBufferMs()
    {
        var pending = Bass.ChannelGetData(stream, IntPtr.Zero, (int)DataFlags.Available);
        var bufferedMs = pending > 0 ? Bass.ChannelBytes2Seconds(stream, pending) * 1000 : 0;
        return Math.Max(0, bufferedMs + deviceLatencyMs * currentRate);
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
                stream = BassFx.TempoCreate(decode, BassFlags.FxFreeSource);
                if (stream == 0) throw new InvalidOperationException($"BASS_FX_TempoCreate: {Bass.LastError}");
                // lazer PlaybackControl → AdjustableProperty.Tempo: BASS_ATTRIB_TEMPO 为相对百分比, 音高不变。
                if (!Bass.ChannelSetAttribute(stream, ChannelAttribute.Tempo, (rate - 1) * 100))
                    throw new InvalidOperationException($"BASS_ATTRIB_TEMPO: {Bass.LastError}");
                Bass.ChannelSetAttribute(stream, ChannelAttribute.Volume, volume);
                if (offset > 0 && !Bass.ChannelSetPosition(stream, Bass.ChannelSeconds2Bytes(stream, offset), PositionFlags.Bytes))
                    throw new InvalidOperationException($"BASS.ChannelSetPosition: {Bass.LastError}");
                if (!Bass.ChannelPlay(stream, false)) throw new InvalidOperationException($"BASS.ChannelPlay: {Bass.LastError}");
                currentRequestId = requestId;
                currentRate = rate;
                playing = true;
                // v620: 起播即返回实际位置与同点输出缓冲, 统一换算成人耳可闻位置
                var seconds = Bass.ChannelBytes2Seconds(stream, Bass.ChannelGetPosition(stream, PositionFlags.Bytes));
                Send(new { type = "play-ack", requestId, ok = true, rate, seconds, bufferMs = PendingBufferMs() });
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
        Bass.GetInfo(out var deviceInfo);
        deviceLatencyMs = deviceInfo.Latency;
        Send(new { type = "ready" });
        // v620: 50ms 位置更新保持轻量; Available 仅每 1000ms 校准一次实际输出缓冲
        var positionTimer = new Timer(_ =>
        {
            lock (sync)
            {
                if (!playing || stream == 0) return;
                var seconds = Bass.ChannelBytes2Seconds(stream, Bass.ChannelGetPosition(stream, PositionFlags.Bytes));
                var now = Environment.TickCount64;
                if (now - lastBufferSampleMs >= 1000)
                {
                    lastBufferSampleMs = now;
                    Send(new { type = "position", requestId = currentRequestId, seconds, bufferMs = PendingBufferMs() });
                }
                else Send(new { type = "position", requestId = currentRequestId, seconds });
            }
        }, null, 0, 50);
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
                            Send(new { type = "position", requestId = currentRequestId, playing, seconds = stream == 0 ? 0 : Bass.ChannelBytes2Seconds(stream, Bass.ChannelGetPosition(stream, PositionFlags.Bytes)), bufferMs = stream == 0 ? 0 : PendingBufferMs() });
                            break;
                        case "shutdown": FreeStream(); return;
                    }
                }
            }
        }
        finally
        {
            positionTimer.Dispose();
            FreeStream();
            Bass.Free();
        }
    }
}
