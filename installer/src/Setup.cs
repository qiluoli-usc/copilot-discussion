using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Copilot 主题讨论安装程序")]
[assembly: AssemblyDescription("Windows x64 · Jev Native · 离线安装与宿主配置")]
[assembly: AssemblyVersion("0.8.0.0")]
[assembly: AssemblyFileVersion("0.8.0.0")]

internal static class Program
{
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
    internal static readonly Encoding Utf8 = new UTF8Encoding(false);
    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            if (args.Length == 2 && args[0] == "--self-test")
            {
                using (var form = new SetupForm())
                {
                    form.CreateControl(); form.PerformLayout();
                    var report = form.SelfTest();
                    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[1])));
                    File.WriteAllText(args[1], Json.Serialize(report), Utf8);
                }
                return 0;
            }
            // This unattended entry is for reproducible installer validation.
            // Ordinary users double-click the EXE and use the same engine in UI.
            if (args.Length == 2 && args[0] == "--smoke-install")
            {
                var requestFile = Path.GetFullPath(args[1]);
                var request = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(requestFile, Utf8));
                var result = Engine.Install(request, delegate(string s) { });
                File.WriteAllText(requestFile + ".result.json", Json.Serialize(result), Utf8);
                return 0;
            }
            Application.Run(new SetupForm());
            return 0;
        }
        catch (Exception e)
        {
            if (args.Length == 2 && args[0].StartsWith("--", StringComparison.Ordinal))
            {
                File.WriteAllText(args[1] + ".error.txt", e.Message, Utf8);
                return 1;
            }
            MessageBox.Show(e.Message, "安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal static class Engine
{
    internal static string Quote(string value)
    {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    internal static string Child(string root, string relative)
    {
        if (String.IsNullOrWhiteSpace(relative) || relative.Contains(":") || relative.Contains("\\") || relative.Split('/').Any(p => p == ".." || p == "." || p == "")) throw new InvalidDataException("安装包路径无效。");
        var target = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("安装包路径超出目标目录。");
        return target;
    }
    static string Hash(Stream stream) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    internal static bool HasPayload { get { return Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains("payload.zip"); } }
    internal static void Verify(string root, Action<string> log)
    {
        var manifest = Program.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, "bundle.json"), Program.Utf8));
        if ((string)manifest["version"] != BuildInfo.Version || (string)manifest["arch"] != "x64") throw new InvalidDataException("产品版本或架构不匹配。");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Dictionary<string, object> item in (System.Collections.IEnumerable)manifest["files"])
        {
            string relative = (string)item["path"], file = Child(root, relative);
            if (!seen.Add(relative)) throw new InvalidDataException("安装包路径重复。");
            var info = new FileInfo(file);
            if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0 || info.Length != Convert.ToInt64(item["bytes"])) throw new InvalidDataException("文件缺失或大小不符：" + relative);
            using (var stream = File.OpenRead(file)) if (Hash(stream) != (string)item["sha256"]) throw new InvalidDataException("文件校验失败：" + relative);
        }
        log("离线组件完整性校验通过。");
    }
    static string Prepare(string installRoot, Action<string> log)
    {
        var root = Path.GetFullPath(installRoot);
        var versionRoot = Path.Combine(root, "versions", BuildInfo.Version);
        if (Directory.Exists(versionRoot)) { log("检测到本版本产品，验证后复用。"); Verify(versionRoot, log); return versionRoot; }
        if (!HasPayload)
        {
            var own = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (File.Exists(Path.Combine(own, "bundle.json"))) { Verify(own, log); return own; }
            throw new InvalidOperationException("请使用完整离线 Setup.exe 安装；当前文件仅用于已安装产品的配置。");
        }
        var stagingRoot = Path.Combine(root, "staging"); Directory.CreateDirectory(stagingRoot);
        var staging = Path.Combine(stagingRoot, Guid.NewGuid().ToString("N"));
        var zip = staging + ".zip";
        log("正在展开离线安装包，请稍候……");
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (var file = new FileStream(zip, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
        {
            resource.CopyTo(file); file.Position = 0;
            if (Hash(file) != BuildInfo.PayloadSha256) throw new InvalidDataException("安装程序内置包损坏，请重新复制完整安装程序。");
        }
        Directory.CreateDirectory(staging);
        using (var archive = ZipFile.OpenRead(zip))
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in archive.Entries)
            {
                if (entry.FullName.EndsWith("/", StringComparison.Ordinal)) continue;
                if (!names.Add(entry.FullName)) throw new InvalidDataException("安装包含重复路径。");
                var target = Child(staging, entry.FullName);
                if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw new InvalidDataException("安装包不接受符号链接。");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var source = entry.Open()) using (var output = new FileStream(target, FileMode.CreateNew)) source.CopyTo(output);
            }
        }
        Verify(staging, log);
        Directory.CreateDirectory(Path.GetDirectoryName(versionRoot));
        // Only our verified staging directory moves; never replace existing roots.
        Directory.Move(staging, versionRoot);
        File.Delete(zip);
        return versionRoot;
    }
    internal static Dictionary<string, object> Run(string node, string script, string requestFile, Action<string> log)
    {
        var info = new ProcessStartInfo(node, Quote(script) + " " + Quote(requestFile)) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Program.Utf8, StandardErrorEncoding = Program.Utf8 };
        info.EnvironmentVariables["PYTHONUTF8"] = "1";
        info.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"] = "1";
        Dictionary<string, object> result = null; string error = null;
        using (var process = new Process { StartInfo = info })
        {
            process.Start();
            // Consume stderr without exposing proxy settings or other inherited data.
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { };
            process.BeginErrorReadLine();
            string line;
            while ((line = process.StandardOutput.ReadLine()) != null)
            {
                Dictionary<string, object> item;
                try { item = Program.Json.Deserialize<Dictionary<string, object>>(line); } catch { continue; }
                object type; if (!item.TryGetValue("type", out type)) continue;
                if ((string)type == "complete") result = (Dictionary<string, object>)item["result"];
                else if ((string)type == "error") error = Convert.ToString(item["message"]);
                else if ((string)type == "progress") log(ProgressText(Convert.ToString(item["stage"]), Convert.ToString(item["action"])));
            }
            process.WaitForExit();
            if (process.ExitCode != 0 || result == null) throw new InvalidOperationException(error ?? "安装后端未完成。文件与报告已保留，可重新运行安装程序。");
        }
        return result;
    }
    static string ProgressText(string stage, string action)
    {
        var labels = new Dictionary<string, string> { { "bundle", "离线文件" }, { "runtime", "Jev 运行时" }, { "python", "Python 环境" }, { "dependencies", "Python 依赖" }, { "browser", "浏览器" } };
        var actions = new Dictionary<string, string> { { "verified", "校验通过" }, { "reused", "已复用" }, { "copied", "已准备" }, { "creating", "正在创建" }, { "installing-offline", "正在从随包文件安装" } };
        return (labels.ContainsKey(stage) ? labels[stage] : stage) + "：" + (actions.ContainsKey(action) ? actions[action] : action);
    }
    internal static Dictionary<string, object> Install(Dictionary<string, object> request, Action<string> log)
    {
        var started = DateTime.UtcNow;
        var root = Path.GetFullPath((string)request["installRoot"]);
        if (root.TrimEnd('\\').Length <= 3) throw new InvalidOperationException("请选择专用安装文件夹，不能直接使用磁盘根目录。");
        if (!Environment.Is64BitOperatingSystem || Environment.OSVersion.Version.Major < 10) throw new InvalidOperationException("需要 Windows 10 / 11 x64。");
        Directory.CreateDirectory(root);
        using (var mutex = new FileStream(Path.Combine(root, ".setup.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
        {
            request["installerStartedAt"] = started.ToString("o");
            var payloadStarted = DateTime.UtcNow;
            var payload = Prepare(root, log);
            var payloadElapsed = (DateTime.UtcNow - payloadStarted).TotalMilliseconds;
            var output = Path.Combine(root, "profiles", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff")); Directory.CreateDirectory(output);
            request["dataDir"] = Path.Combine(root, "data"); request["output"] = output;
            var requestFile = Path.Combine(output, "installer-request.json");
            File.WriteAllText(requestFile, Program.Json.Serialize(request), Program.Utf8);
            log("安装到当前用户目录，无需管理员权限。");
            var backendStarted = DateTime.UtcNow;
            var result = Run(Path.Combine(payload, "tools", "node", "node.exe"), Path.Combine(payload, "installer", "app", "install.mjs"), requestFile, log);
            result["installerStartedAt"] = started.ToString("o"); result["installerElapsedMs"] = (DateTime.UtcNow - started).TotalMilliseconds;
            result["installRoot"] = root; result["payloadRoot"] = payload;
            result["installerStages"] = new { payloadPrepareMs = payloadElapsed, backendMs = (DateTime.UtcNow - backendStarted).TotalMilliseconds };
            File.WriteAllText(Path.Combine(root, "setup-state.json"), Program.Json.Serialize(result), Program.Utf8);
            object shortcuts;
            if (request.TryGetValue("shortcuts", out shortcuts) && Convert.ToBoolean(shortcuts))
            {
                try
                {
                    var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Copilot 主题讨论"); Directory.CreateDirectory(menu);
                    Shortcut(Path.Combine(menu, "开始使用.lnk"), (string)result["guideFile"]);
                    Shortcut(Path.Combine(menu, "配置与检查.lnk"), Path.Combine(payload, "CopilotDiscussion.exe"));
                }
                catch { log("开始菜单入口创建受限；仍可从安装目录打开使用指南。"); }
            }
            log("软件安装完成。请继续完成浏览器授权和宿主接入。");
            return result;
        }
    }
    static void Shortcut(string file, string target)
    {
        var type = Type.GetTypeFromProgID("WScript.Shell"); var shell = Activator.CreateInstance(type);
        var shortcut = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
        shortcut.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
        shortcut.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        System.Runtime.InteropServices.Marshal.ReleaseComObject(shortcut); System.Runtime.InteropServices.Marshal.ReleaseComObject(shell);
    }
}

internal sealed class SetupForm : Form
{
    readonly TextBox root = new TextBox(), workspace = new TextBox(), skillsDir = new TextBox(), log = new TextBox();
    readonly ComboBox host = new ComboBox();
    readonly CheckBox chrome = new CheckBox(), skills = new CheckBox(), reuse = new CheckBox(), shortcuts = new CheckBox();
    readonly Button install = new Button(), guide = new Button(), copy = new Button(), check = new Button(), browse = new Button();
    readonly ProgressBar progress = new ProgressBar();
    readonly string config = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".copilot-discussion", "config.json");
    readonly string[] hosts = { "generic", "codex", "claude-code", "workbuddy", "dsh", "qwenwork", "github-copilot", "vscode" };
    Dictionary<string, object> result; bool busy;
    internal SetupForm()
    {
        Text = "Copilot 主题讨论 · 安装向导 " + BuildInfo.Version; Font = new Font("Microsoft YaHei UI", 10F);
        AutoScaleMode = AutoScaleMode.Dpi; ClientSize = new Size(850, 720); MinimumSize = new Size(820, 700); StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(246, 248, 252);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 3, RowCount = 13 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 116)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 84));
        foreach (float h in new float[] { 46, 52, 42, 42, 42, 38, 38, 38, 56, 28 }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, h));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        Controls.Add(layout);
        var title = new Label { Text = "Copilot 主题讨论", Font = new Font(Font.FontFamily, 21F, FontStyle.Bold), Dock = DockStyle.Fill }; Span(layout, title, 0);
        Span(layout, new Label { Text = "离线安装 Jev Native、Node、Python 与依赖。\n自动选题、持续追问、完整记录和分阶段计时由所选宿主与本插件共同完成。", Dock = DockStyle.Fill }, 1);
        root.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CopilotDiscussion");
        if (!Engine.HasPayload) root.Text = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        workspace.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "CopilotResearch");
        try { var old = Program.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(config, Program.Utf8)); object value; if (old.TryGetValue("workspaceDir", out value) && value is string) workspace.Text = (string)value; } catch { }
        Field(layout, "安装目录", root, 2, true); Field(layout, "研究工作区", workspace, 3, true);
        host.DropDownStyle = ComboBoxStyle.DropDownList; host.Items.AddRange(new object[] { "通用 MCP / 稍后接入", "Codex", "Claude Code", "WorkBuddy", "DSH", "QwenWork", "GitHub Copilot CLI", "VS Code GitHub Copilot" }); host.SelectedIndex = 0; Field(layout, "主持宿主", host, 4, false);
        skills.Text = "为所选宿主安装两个研究技能"; skills.AutoSize = true; Span(layout, skills, 5);
        skillsDir.PlaceholderCompat("WorkBuddy 请在勾选技能安装后选择实际技能目录"); Field(layout, "技能目录", skillsDir, 6, true);
        reuse.Text = "优先复用本机已有 Jev 环境"; reuse.Checked = true; shortcuts.Text = "创建开始菜单入口"; shortcuts.Checked = true;
        var options = new FlowLayoutPanel { Dock = DockStyle.Fill }; options.Controls.Add(reuse); options.Controls.Add(shortcuts); reuse.AutoSize = shortcuts.AutoSize = true; Span(layout, options, 7);
        chrome.Text = "缺少 Chrome 时安装随包的 Google Chrome（已有浏览器直接复用）"; chrome.Checked = true; chrome.AutoSize = true;
        var chromeBox = new FlowLayoutPanel { Dock = DockStyle.Fill }; chromeBox.Controls.Add(chrome);
        var terms = new LinkLabel { Text = "Google Chrome 条款", AutoSize = true }; terms.LinkClicked += delegate { Open("https://www.google.com/chrome/terms/"); }; chromeBox.Controls.Add(terms); Span(layout, chromeBox, 8);
        progress.Dock = DockStyle.Fill; Span(layout, progress, 9);
        log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Vertical; log.Dock = DockStyle.Fill; log.BackColor = Color.White; Span(layout, log, 10);
        Span(layout, new Label { Text = "浏览器远程调试、Allow 及 Microsoft 登录由你完成。默认无需 Jev API Key。", Dock = DockStyle.Fill, ForeColor = Color.FromArgb(72, 90, 112) }, 11);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
        install.Text = Engine.HasPayload ? "开始安装" : "保存配置"; guide.Text = "使用指南"; copy.Text = "复制 MCP"; check.Text = "授权检查"; browse.Text = "打开目录";
        foreach (var b in new[] { install, guide, copy, check, browse }) { b.AutoSize = true; b.Height = 34; buttons.Controls.Add(b); }
        Span(layout, buttons, 12);
        guide.Enabled = copy.Enabled = check.Enabled = browse.Enabled = false;
        install.Click += async delegate { await Install(); };
        guide.Click += delegate { Open((string)result["guideFile"]); };
        copy.Click += delegate { Clipboard.SetText((string)result["profileText"]); Append("已复制所选宿主配置，请在宿主的 MCP 配置界面中导入。"); };
        browse.Click += delegate { Open((string)result["outputDir"]); };
        check.Click += async delegate { await Check(); };
        host.SelectedIndexChanged += delegate { SkillsState(); };
        skills.CheckedChanged += delegate { skillsDir.Enabled = skills.Checked && host.SelectedIndex == 3; };
        SkillsState();
        Append("软件组件可离线安装；公开资料与 Copilot 对话需要联网。");
        Append("此包支持 Windows 10 / 11 x64，安装期间不会向 Copilot 发问。");
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) { e.Cancel = true; Append("正在写入安装文件，请等待当前步骤完成后关闭。"); } };
    }
    void SkillsState() { skills.Enabled = host.SelectedIndex != 0; skills.Checked = host.SelectedIndex != 0 && host.SelectedIndex != 3; skillsDir.Enabled = skills.Checked && host.SelectedIndex == 3; }
    static void Span(TableLayoutPanel layout, Control c, int row) { layout.Controls.Add(c, 0, row); layout.SetColumnSpan(c, 3); }
    static void Field(TableLayoutPanel layout, string label, Control field, int row, bool folder)
    {
        layout.Controls.Add(new Label { Text = label, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, row); field.Dock = DockStyle.Fill; field.Margin = new Padding(3, 6, 5, 3); layout.Controls.Add(field, 1, row);
        if (folder) { var b = new Button { Text = "选择…", Dock = DockStyle.Fill, Margin = new Padding(3, 4, 0, 4) }; b.Click += delegate { using (var dialog = new FolderBrowserDialog { Description = label, SelectedPath = field.Text }) if (dialog.ShowDialog() == DialogResult.OK) field.Text = dialog.SelectedPath; }; layout.Controls.Add(b, 2, row); }
        else layout.SetColumnSpan(field, 2);
    }
    void Append(string message) { if (InvokeRequired) { BeginInvoke((Action<string>)Append, message); return; } log.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + message + Environment.NewLine); }
    void Busy(bool value) { busy = value; install.Enabled = !value; progress.Style = value ? ProgressBarStyle.Marquee : ProgressBarStyle.Blocks; progress.Value = value ? 0 : 100; root.Enabled = workspace.Enabled = host.Enabled = chrome.Enabled = reuse.Enabled = shortcuts.Enabled = !value; check.Enabled = !value && result != null; }
    async Task Install()
    {
        try
        {
            if (!Path.IsPathRooted(root.Text) || !Path.IsPathRooted(workspace.Text)) throw new InvalidOperationException("请选择完整的安装目录和研究工作区路径。");
            if (skills.Checked && host.SelectedIndex == 3 && !Path.IsPathRooted(skillsDir.Text)) throw new InvalidOperationException("WorkBuddy 技能安装需要选择实际技能目录，也可取消此选项后从宿主界面导入。");
            var request = new Dictionary<string, object> { { "installRoot", root.Text }, { "workspace", workspace.Text }, { "config", config }, { "host", hosts[host.SelectedIndex] }, { "installChrome", chrome.Checked }, { "installSkills", skills.Checked }, { "skillsDir", skillsDir.Enabled ? skillsDir.Text : null }, { "reuseEnvironment", reuse.Checked }, { "shortcuts", shortcuts.Checked } };
            Busy(true); result = await Task.Run(() => Engine.Install(request, Append));
            guide.Enabled = copy.Enabled = browse.Enabled = true;
            Append("本次完整安装耗时 " + (Convert.ToDouble(result["installerElapsedMs"]) / 1000).ToString("F3") + " 秒。");
            Append("点击“使用指南”接入宿主。首次连接前，请在 Chrome 启用远程调试并批准 Allow。");
        }
        catch (Exception e) { Append("安装未完成：" + e.Message); MessageBox.Show(e.Message, "安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        finally { Busy(false); }
    }
    async Task Check()
    {
        Append("将连接本机 Chrome。请打开 chrome://inspect/#remote-debugging，启用远程调试并批准 Allow；不会发送问题或调用决策模型。");
        try
        {
            Busy(true);
            var payload = (string)result["payloadRoot"];
            var value = await Task.Run(() => Engine.Run(Path.Combine(payload, "tools", "node", "node.exe"), Path.Combine(payload, "installer", "app", "check-browser.mjs"), (string)result["configFile"], Append));
            Append(Convert.ToString(value["message"]));
        }
        catch (Exception e) { Append(e.Message); }
        finally { Busy(false); }
    }
    static void Open(string target) { try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch (Exception e) { MessageBox.Show(e.Message); } }
    internal object SelfTest()
    {
        if (install.Text.Length == 0 || host.Items.Count != 8 || ClientSize.Width < 800 || log.Height < 80 || install.Width < 60) throw new InvalidOperationException("安装界面自检失败。");
        bool traversal = false; try { Engine.Child(Path.GetTempPath(), "../escape"); } catch (InvalidDataException) { traversal = true; }
        if (!traversal || Engine.Quote("a b\\") != "\"a b\\\\\"") throw new InvalidOperationException("路径或参数保护自检失败。");
        return new { passed = true, version = BuildInfo.Version, hasEmbeddedPayload = Engine.HasPayload, hostCount = host.Items.Count, clientWidth = ClientSize.Width, clientHeight = ClientSize.Height, controls = Flatten(this).Select(c => new { type = c.GetType().Name, text = c is TextBox ? "" : c.Text, width = c.Width, height = c.Height }).ToArray() };
    }
    static IEnumerable<Control> Flatten(Control c) { foreach (Control child in c.Controls) { yield return child; foreach (var nested in Flatten(child)) yield return nested; } }
}

internal static class Compatibility
{
    // .NET Framework 4.x TextBox has no PlaceholderText; keep the hint as tooltip.
    internal static void PlaceholderCompat(this TextBox text, string hint) { new ToolTip().SetToolTip(text, hint); }
}
