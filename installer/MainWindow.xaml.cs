using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace OpenClawSetup
{
    public partial class MainWindow : Window
    {
        private readonly System.Windows.Forms.FolderBrowserDialog _fbd = new();
        private string? _installDir;
        private int _installing;
        private bool Installing() => Interlocked.CompareExchange(ref _installing, 0, 0) == 1;
        private bool _desktopShortcut = true;
        private bool _startMenuShortcut = true;
        private bool _autoStart;

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h);
        [DllImport("user32.dll")]
        private static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

        public MainWindow()
        {
            InitializeComponent();
            try
            {
                var ico = Path.Combine(AppContext.BaseDirectory, "openclaw.ico");
                if (File.Exists(ico)) Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri(ico));
            }
            catch { }
            SourceInitialized += (_, _) => ApplyRoundedCorners();
            Loaded += async (_, _) => await InitWebAsync();

            // AUTOTEST (env OPENCLAW_SETUP_AUTOTEST=1): самопроверка цепочки C#->JS без кликов.
            // Установка ~250 МБ занимает 60–120 c, поэтому завершающие клики НЕ привязаны к
            // фиксированным таймингам: ждём реальное сообщение "done" (хук __onDone в ui.html)
            // с polling-страховкой и watchdog на 240 c.
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("OPENCLAW_SETUP_AUTOTEST")))
            {
                _ = Dispatcher.InvokeAsync(async () =>
                {
                    try
                    {
                        await Task.Delay(3000);
                        App.Log("autotest: go(4) + install to temp");
                        await Web.CoreWebView2.ExecuteScriptAsync(
                            "window.__installSent = false; go(4); setTimeout(function(){ bridge('install', { path: 'C:\\\\Temp\\\\OpenClawSetup\\\\autotest', lang: 'ru', desktop: false, startMenu: false, autoStart: false }); window.__installSent = true; }, 600);" +
                            "window.__onDone = function(){ if (window.__onDoneFired) return; window.__onDoneFired = true; try { clearInterval(window.__doneTimer); } catch(e){};" +
                            " setTimeout(function(){ var b = document.querySelector('.prog .btn-primary'); if (b) b.click(); }, 300);" +
                            " setTimeout(function(){ var a = document.querySelector('.screen.active'); var bf = document.querySelector('.bar-fill'); var b = document.querySelector('.prog .btn-primary'); var p = document.querySelector('.prog .p-step'); var sb = document.getElementById('sb-text'); bridge('log', { msg: 'probe-ui2: ' + [a ? a.id : 'none', bf ? bf.style.width : '-', b ? (b.className + ' | ' + b.textContent + ' | disp=' + (b.style.display || 'auto')) : '-', p ? p.textContent : '-', sb ? sb.textContent : '-'].join(' | ') }); }, 600);" +
                            " setTimeout(function(){ var l = document.querySelector('.fin .launch-opt'); var c = document.querySelector('.fin .launch-opt input'); var k = document.querySelector('.launch-opt .chk'); bridge('log', { msg: 'js: chk-before=' + (c ? c.checked : 'none') + ' vis=' + getComputedStyle(k, '::after').opacity }); if (l) l.click(); setTimeout(function(){ bridge('log', { msg: 'js: chk-after=' + (c ? c.checked : 'none') + ' vis=' + getComputedStyle(k, '::after').opacity }); }, 500); }, 1200);" +
                            " setTimeout(function(){ var f = document.querySelector('.fin .btn-primary'); if (f) f.click(); }, 2000); };" +
                            "window.__doneTimer = setInterval(function(){ var b = document.querySelector('.prog .btn-primary'); if (window.__installSent && b && b.className.indexOf('waiting') < 0 && window.__onDone) { window.__onDone(); } }, 700);" +
                            "setTimeout(function(){ try { clearInterval(window.__doneTimer); } catch(e){}; }, 240000);" +
                            "setTimeout(function(){ var a = document.querySelector('.screen.active'); var bf = document.querySelector('.bar-fill'); var b = document.querySelector('.prog .btn-primary'); var p = document.querySelector('.prog .p-step'); var sb = document.getElementById('sb-text'); bridge('log', { msg: 'probe-ui: ' + [a ? a.id : 'none', bf ? bf.style.width : '-', b ? (b.className + ' | ' + b.textContent + ' | disp=' + (b.style.display || 'auto')) : '-', p ? p.textContent : '-', sb ? sb.textContent : '-'].join(' | ') }); }, 13000);");
                    }
                    catch (Exception ex) { App.Log($"autotest: {ex.Message}"); }
                });
            }
        }

        private void ApplyRoundedCorners()
        {
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                var dpi = VisualTreeHelper.GetDpi(this);
                var w = (int)Math.Round(ActualWidth * dpi.DpiScaleX);
                var h = (int)Math.Round(ActualHeight * dpi.DpiScaleY);
                var rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, 40, 40);
                SetWindowRgn(hwnd, rgn, true);
            }
            catch (Exception ex) { App.Log("rounded: " + ex); }
        }

        private async Task InitWebAsync()
        {
            try
            {
                var userData = Path.Combine(Path.GetTempPath(), "OpenClawSetup",
                    "webview2-" + Environment.ProcessId);
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                Exception? last = null;
                for (var attempt = 1; attempt <= 5; attempt++)
                {
                    try { await Web.EnsureCoreWebView2Async(env); last = null; break; }
                    catch (Exception ex)
                    {
                        last = ex;
                        App.Log("wv2 retry " + attempt + ": " + ex.Message);
                        await Task.Delay(2000);
                    }
                }
                if (last != null) throw last;
                Web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                Web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                Web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                Web.CoreWebView2.WebMessageReceived += OnWebMessage;
                var html = LoadHtml();
                App.Log("html: " + html.Length + " bytes, bridge=" + html.Contains("WebView2 bridge (injected)"));
                Web.CoreWebView2.NavigateToString(html);
                Web.CoreWebView2.DocumentTitleChanged += (_, _) =>
                    App.Log("title: " + (Web.CoreWebView2.DocumentTitle ?? ""));
                _ = Dispatcher.InvokeAsync(async () =>
                {
                    await Task.Delay(4000);
                    try
                    {
                        var r = await Web.CoreWebView2.ExecuteScriptAsync(
                            "window.__bridgeAlive === true ? 'BRIDGE-ALIVE' : 'BRIDGE-DEAD'");
                        App.Log("probe: " + r);
                    }
                    catch (Exception ex) { App.Log("probe err: " + ex.Message); }
                });
                App.Log("webview2: initialized OK");
            }
            catch (Exception ex)
            {
                App.Log("init: " + ex);
                System.Windows.MessageBox.Show("Не удалось инициализировать WebView2:\n\n" + ex,
                    "OpenClaw Setup", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private static string LoadHtml()
        {
            var asm = Assembly.GetExecutingAssembly();
            var name = asm.GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith("ui.html", StringComparison.OrdinalIgnoreCase))
                ?? throw new FileNotFoundException("ui.html resource not found; resources: " +
                    string.Join(",", asm.GetManifestResourceNames()));
            using var rs = asm.GetManifestResourceStream(name)!;
            using var sr = new StreamReader(rs);
            var html = sr.ReadToEnd();
            try
            {
                var defDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "OpenClaw PC");
                App.Log("html: default install dir=" + defDir);
                html = html.Replace("__DEFAULT_INSTALL_DIR__", defDir);
            }
            catch (Exception ex) { App.Log("html default dir: " + ex.Message); }
            return html;
        }

        private void Post(string cmd, Dictionary<string, object?>? payload = null)
        {
            // Safe from any thread: Dispatcher/DispatcherObject.Dispatcher may be read
            // cross-thread. NOTE: do NOT touch IsLoaded/CoreWebView2 here — those are
            // DispatcherObjects and throw InvalidOperationException off the UI thread.
            if (Dispatcher.HasShutdownStarted) return;
            var obj = new Dictionary<string, object?> { ["cmd"] = cmd };
            if (payload != null)
                foreach (var kv in payload) obj[kv.Key] = kv.Value;
            var json = JsonSerializer.Serialize(obj);
            try
            {
                if (Dispatcher.CheckAccess())
                    PostInner(json);
                else
                    Dispatcher.Invoke(() => PostInner(json));
            }
            catch (Exception ex) { App.Log("post: " + ex.GetType().Name); }
        }

        private void PostInner(string json)
        {
            // Runs on the UI thread; window may already be closing (late progress tick
            // after "finish") — then the view is gone and posting is a no-op.
            if (!IsLoaded || Web?.CoreWebView2 == null) return;
            Web.CoreWebView2.PostWebMessageAsJson(json);
        }

        private static bool GetBool(JsonElement root, string name, bool def)
        {
            return root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.True;
        }

        private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try { HandleWebMessage(e); }
            catch (Exception ex) { App.Log("msg handler: " + ex); }
        }

        private void HandleWebMessage(CoreWebView2WebMessageReceivedEventArgs e)
        {
            JsonDocument doc;
            try { doc = JsonDocument.Parse(e.WebMessageAsJson); }
            catch { return; }
            if (!doc.RootElement.TryGetProperty("cmd", out var cmdEl)) return;
            var cmd = cmdEl.GetString();
            App.Log("msg: " + cmd);
            switch (cmd)
            {
                case "minimize":
                    App.Log("msg: minimize");
                    Dispatcher.Invoke(() => WindowState = WindowState.Minimized);
                    break;
                case "close":
                    App.Log("msg: close");
                    if (Installing()) { App.Log("close: ignored while installing"); break; }
                    Dispatcher.Invoke(Close);
                    break;
                case "log":
                {
                    var msg = doc.RootElement.TryGetProperty("msg", out var me) ? me.GetString() : "";
                    App.Log("js: " + msg);
                    break;
                }
                case "chooseDir":
                {
                    string? path = null;
                    Dispatcher.Invoke(() =>
                    {
                        if (_fbd.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                            path = _fbd.SelectedPath;
                    });
                    if (path != null)
                        Post("dirPicked", new Dictionary<string, object?> { ["path"] = path });
                    break;
                }
                case "install":
                {
                    var path = doc.RootElement.TryGetProperty("path", out var p) ? p.GetString() : "";
                    var lang = doc.RootElement.TryGetProperty("lang", out var l) ? l.GetString() : "en";
                    _desktopShortcut = GetBool(doc.RootElement, "desktop", true);
                    _startMenuShortcut = GetBool(doc.RootElement, "startMenu", true);
                    _autoStart = GetBool(doc.RootElement, "autoStart", false);
                    var lcid = lang switch { "ru" => 1049, "zh" => 2052, _ => 1033 };
                    App.Log($"install: requested dir='{path}' lang={lang} desktop={_desktopShortcut} startMenu={_startMenuShortcut} autoStart={_autoStart}");
                    _ = Task.Run(() => RunInstall(path, lcid));
                    break;
                }
                case "finish":
                {
                    if (Installing()) { App.Log("finish: ignored while installing"); break; }
                    var launch = doc.RootElement.TryGetProperty("launch", out var la) && la.GetBoolean();
                    App.Log("finish: launch=" + launch);
                    if (launch && _installDir != null)
                    {
                        var app = Path.Combine(_installDir, "OpenClaw PC.exe");
                        if (File.Exists(app))
                            Process.Start(new ProcessStartInfo(app) { UseShellExecute = true });
                    }
                    Dispatcher.Invoke(Close);
                    break;
                }
            }
        }

        private async Task RunInstall(string? userPath, int lcid)
        {
            if (Interlocked.Exchange(ref _installing, 1) == 1) return;
            try
            {
                // Single-file distribution: the NSIS core is appended to this exe
                // (footer: magic + payload length). Dev layout: core.exe beside the app.
                var corePath = Path.Combine(AppContext.BaseDirectory, "core.exe");
                if (!File.Exists(corePath))
                    corePath = ExtractBundledCore();
                if (corePath == null || !File.Exists(corePath))
                {
                    App.Log("install: core.exe not found and no bundled payload");
                    Post("error", new Dictionary<string, object?> { ["line"] = "installer core not found" });
                    return;
                }
                App.Log($"install: core source={corePath}");
                var logPath = Path.Combine(Path.GetTempPath(), "OpenClawSetup", "install.log");
                Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
                if (File.Exists(logPath)) File.Delete(logPath);

                var psi = new ProcessStartInfo(corePath) { UseShellExecute = false, CreateNoWindow = true };
                psi.ArgumentList.Add("/S");
                psi.ArgumentList.Add($"/LANG={lcid}");
                psi.ArgumentList.Add($"/LOG={logPath}");
                if (!string.IsNullOrWhiteSpace(userPath))
                    psi.ArgumentList.Add($"/D={userPath}");

                App.Log($"install: starting core lang={lcid} dir={(string.IsNullOrWhiteSpace(userPath) ? "(default)" : userPath)}");
                using var proc = Process.Start(psi);
                if (proc == null)
                {
                    App.Log("install: Process.Start returned null");
                    Post("error", new Dictionary<string, object?> { ["line"] = "failed to start installer" });
                    return;
                }
                App.Log($"install: core started pid={proc.Id}");

                var known = KnownTotalLines();
                using var timer = new System.Threading.Timer(_ => ReportProgress(logPath, known), null, 1200, 350);

                _progressStart = DateTime.UtcNow;
                var started = DateTime.UtcNow;
                var lastProgress = DateTime.UtcNow;
                while (!proc.HasExited)
                {
                    await Task.Delay(300);
                    if (CountLines(logPath, "Extract:") > 0) lastProgress = DateTime.UtcNow;
                    if ((DateTime.UtcNow - lastProgress).TotalSeconds > 120 && (DateTime.UtcNow - started).TotalSeconds > 15)
                    {
                        App.Log("install: watchdog — no progress for 120s");
                        try { proc.Kill(); } catch { }
                        Post("error", new Dictionary<string, object?> { ["line"] = "installer is not responding (no progress for 120s)" });
                        return;
                    }
                }
                timer.Dispose();
                App.Log($"install: core exited code={proc.ExitCode}");

                _installDir = FindInstallDir(logPath) ?? (string.IsNullOrWhiteSpace(userPath) ? null : userPath);
                if (proc.ExitCode == 0 && _installDir != null)
                {
                    SaveKnownTotalLines(CountLines(logPath, "Extract:"));
                    ApplyShortcuts();
                    App.Log($"install: DONE dir={_installDir}");
                    Post("done");
                }
                else if (proc.ExitCode == 0)
                {
                    App.Log("install: exit 0 but installDir unknown");
                    Post("error", new Dictionary<string, object?> { ["line"] = "install dir not found in log" });
                }
                else
                {
                    App.Log($"install: failed exit={proc.ExitCode}");
                    Post("error", new Dictionary<string, object?> { ["line"] = $"installer exited with code {proc.ExitCode}" });
                }
            }
            catch (Exception ex)
            {
                App.Log("install: " + ex);
                Post("error", new Dictionary<string, object?> { ["line"] = ex.Message });
            }
            finally { Interlocked.Exchange(ref _installing, 0); }
        }

        private DateTime _progressStart = DateTime.UtcNow;

        /// <summary>Magic of the appended payload footer (must match packer script).</summary>
        private static readonly byte[] PayloadMagic =
            System.Text.Encoding.ASCII.GetBytes("OCPC-SFX-PAYLOAD"); // 16 bytes

        /// <summary>
        /// Extracts the NSIS core appended to this very exe (single-file distribution).
        /// Footer layout (last 24 bytes): magic(16) + payload length Int64 LE.
        /// Returns path to extracted core.exe, or null if this exe has no payload.
        /// </summary>
        private static string? ExtractBundledCore()
        {
            string? self = null;
            try { self = Process.GetCurrentProcess().MainModule?.FileName; } catch { }
            if (string.IsNullOrEmpty(self)) return null;
            try
            {
                using var fs = new FileStream(self, FileMode.Open, FileAccess.Read,
                    FileShare.ReadWrite | FileShare.Delete);
                if (fs.Length < 64) return null;
                var footer = new byte[24];
                fs.Seek(-footer.Length, SeekOrigin.End);
                if (fs.Read(footer, 0, footer.Length) != footer.Length) return null;
                for (var i = 0; i < PayloadMagic.Length; i++)
                    if (footer[i] != PayloadMagic[i]) return null;
                var len = BitConverter.ToInt64(footer, PayloadMagic.Length);
                var start = fs.Length - footer.Length - len;
                if (len <= 0 || start < 0) return null;

                var outDir = Path.Combine(Path.GetTempPath(), "OpenClawSetup");
                Directory.CreateDirectory(outDir);
                var outPath = Path.Combine(outDir, "core.exe");
                App.Log($"extract: payload offset={start} len={len}");
                fs.Seek(start, SeekOrigin.Begin);
                using (var os = new FileStream(outPath, FileMode.Create, FileAccess.Write, FileShare.Read))
                {
                    var buf = new byte[1 << 20];
                    long remaining = len;
                    while (remaining > 0)
                    {
                        var n = fs.Read(buf, 0, (int)Math.Min(buf.Length, remaining));
                        if (n <= 0) break;
                        os.Write(buf, 0, n);
                        remaining -= n;
                    }
                }
                App.Log($"extract: done -> {outPath}");
                return outPath;
            }
            catch (Exception ex)
            {
                App.Log("extract core: " + ex);
                return null;
            }
        }

        private void ReportProgress(string logPath, int known)
        {
            try
            {
                var count = CountLines(logPath, "Extract:");
                int pct;
                if (count > 0 && known > 0)
                    pct = Math.Min(96, (int)((long)count * 96 / known));
                else
                    pct = Math.Min(96, (int)((DateTime.UtcNow - _progressStart).TotalSeconds * 96 / 55));
                var line = ReadLastLine(logPath) ?? "Installing…";
                Post("progress", new Dictionary<string, object?> { ["pct"] = pct, ["line"] = line });
            }
            catch (Exception ex) { App.Log("progress: " + ex); }
        }

        private static int CountLines(string logPath, string prefix)
        {
            try
            {
                if (!File.Exists(logPath)) return 0;
                var n = 0;
                foreach (var line in File.ReadLines(logPath))
                    if (line.Contains(prefix, StringComparison.OrdinalIgnoreCase)) n++;
                return n;
            }
            catch { return 0; }
        }

        private static string? ReadLastLine(string logPath)
        {
            try
            {
                using var fs = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                if (fs.Length == 0) return null;
                var len = Math.Min(2048, fs.Length);
                fs.Seek(-len, SeekOrigin.End);
                using var sr = new StreamReader(fs);
                var text = sr.ReadToEnd();
                var lines = text.Split('\n');
                for (var i = lines.Length - 1; i >= 0; i--)
                {
                    var t = lines[i].Trim().Trim('\r');
                    if (t.Length > 0)
                    {
                        var idx = t.IndexOf("\\", StringComparison.Ordinal);
                        var short_ = t.Length > 110 ? t[..110] : t;
                        if (idx > 0 && idx < 40)
                            short_ = "…" + (t.Length > 110 ? t[^(90 - idx)..] : t[idx..]);
                        return short_;
                    }
                }
                return null;
            }
            catch { return null; }
        }

        private static string? FindInstallDir(string logPath)
        {
            try
            {
                foreach (var line in File.ReadLines(logPath))
                {
                    var t = line.Trim();
                    if (t.StartsWith("Install dir:", StringComparison.OrdinalIgnoreCase))
                        return t["Install dir:".Length..].Trim().Trim('"');
                }
            }
            catch { }
            return null;
        }

        private static int KnownTotalLines()
        {
            try
            {
                var p = Path.Combine(Path.GetTempPath(), "OpenClawSetup", "known-lines.txt");
                return File.Exists(p) && int.TryParse(File.ReadAllText(p).Trim(), out var n) && n > 0 ? n : 2500;
            }
            catch { return 2500; }
        }

        private static void SaveKnownTotalLines(int n)
        {
            try
            {
                if (n <= 0) return;
                var dir = Path.Combine(Path.GetTempPath(), "OpenClawSetup");
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "known-lines.txt"), n.ToString());
            }
            catch { }
        }

        private void ApplyShortcuts()
        {
            try
            {
                if (_installDir == null) return;
                var app = Path.Combine(_installDir, "OpenClaw PC.exe");
                if (!File.Exists(app)) { App.Log("shortcuts: app exe missing: " + app); return; }

                var desktopLinks = new List<string>();
                var startMenuLinks = new List<string>();
                foreach (var profile in UserProfileDirs())
                {
                    var deskDir = Path.Combine(profile, "Desktop");
                    if (Directory.Exists(deskDir))
                        desktopLinks.Add(Path.Combine(deskDir, "OpenClaw PC.lnk"));
                    var smDir = Path.Combine(profile, "AppData", "Roaming", "Microsoft", "Windows",
                        "Start Menu", "Programs");
                    if (Directory.Exists(smDir))
                        startMenuLinks.Add(Path.Combine(smDir, "OpenClaw PC", "OpenClaw PC.lnk"));
                }
                var ownDesk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "OpenClaw PC.lnk");
                if (!desktopLinks.Contains(ownDesk, StringComparer.OrdinalIgnoreCase)) desktopLinks.Add(ownDesk);
                var ownSm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "OpenClaw PC", "OpenClaw PC.lnk");
                if (!startMenuLinks.Contains(ownSm, StringComparer.OrdinalIgnoreCase)) startMenuLinks.Add(ownSm);
                var pubDesk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "OpenClaw PC.lnk");
                if (!desktopLinks.Contains(pubDesk, StringComparer.OrdinalIgnoreCase)) desktopLinks.Add(pubDesk);
                var pubSm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "OpenClaw PC", "OpenClaw PC.lnk");
                if (!startMenuLinks.Contains(pubSm, StringComparer.OrdinalIgnoreCase)) startMenuLinks.Add(pubSm);

                if (_desktopShortcut)
                    foreach (var lnk in desktopLinks) { EnsureDir(lnk); CreateLnk(lnk, app); }
                else
                    foreach (var lnk in desktopLinks) TryDelete(lnk);

                if (_startMenuShortcut)
                    foreach (var lnk in startMenuLinks) { EnsureDir(lnk); CreateLnk(lnk, app); }
                else
                    foreach (var lnk in startMenuLinks) TryDelete(lnk);

                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
                if (_autoStart) key?.SetValue("OpenClaw PC", "\"" + app + "\"");
                else key?.DeleteValue("OpenClaw PC", false);

                App.Log($"shortcuts: applied desktop={_desktopShortcut} ({desktopLinks.Count} lnk) startMenu={_startMenuShortcut} ({startMenuLinks.Count} lnk) autoStart={_autoStart}");
            }
            catch (Exception ex) { App.Log("shortcuts: " + ex); }
        }

        private static IEnumerable<string> UserProfileDirs()
        {
            var dirs = new List<string>();
            void Add(string? p)
            {
                if (!string.IsNullOrWhiteSpace(p) && !dirs.Contains(p, StringComparer.OrdinalIgnoreCase)) dirs.Add(p);
            }
            Add(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList");
                if (key == null) return dirs;
                foreach (var sid in key.GetSubKeyNames())
                {
                    try
                    {
                        using var sk = key.OpenSubKey(sid);
                        var img = sk?.GetValue("ProfileImagePath") as string;
                        if (!string.IsNullOrWhiteSpace(img) &&
                            img.StartsWith(@"C:\Users\", StringComparison.OrdinalIgnoreCase))
                            Add(img);
                    }
                    catch { }
                }
            }
            catch { }
            return dirs;
        }

        private static void EnsureDir(string lnkPath)
        {
            try { Directory.CreateDirectory(Path.GetDirectoryName(lnkPath)!); }
            catch (Exception ex) { App.Log("shortcuts dir: " + ex.Message); }
        }

        private static void TryDelete(string lnkPath)
        {
            try { if (File.Exists(lnkPath)) File.Delete(lnkPath); }
            catch (Exception ex) { App.Log("shortcuts del: " + ex.Message); }
        }

        private static void CreateLnk(string lnkPath, string target)
        {
            try
            {
                var shell = (dynamic)Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
                var sc = shell.CreateShortcut(lnkPath);
                sc.TargetPath = target;
                sc.WorkingDirectory = Path.GetDirectoryName(target);
                sc.IconLocation = target + ",0";
                sc.Save();
                Marshal.FinalReleaseComObject(shell);
                App.Log("shortcuts: lnk ok: " + lnkPath);
            }
            catch (Exception ex) { App.Log("shortcuts createLnk: " + ex); }
        }
    }
}
