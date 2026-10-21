using System;
using System.Linq;
using System.Windows.Forms;

// A separate entry point exercises the real production form without installing
// files, changing host configuration, opening Chrome, or displaying a window.
internal static class GuiSmoke
{
    [STAThread]
    static int Main()
    {
        Console.OutputEncoding = Program.Utf8;
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var form = new SetupForm())
            {
                form.CreateControl(); form.PerformLayout();
                var expected = new[] { "codex", "claude-code", "workbuddy", "github-copilot", "vscode", "qwenwork", "dsh" };
                var actual = HostInstructions.Hosts.Select(h => (string)h["id"]).ToArray();
                if (!expected.SequenceEqual(actual)) throw new InvalidOperationException("The native form must expose all seven supported host instructions.");
                if (!HostInstructions.TextFor("qwenwork").Contains("粘贴JSON配置")) throw new InvalidOperationException("QwenWork manual import instructions are missing.");
                if (!HostInstructions.TextFor("dsh").Contains("dsh web --patch")) throw new InvalidOperationException("DSH profile instructions are missing.");
                if (!Engine.DetectHostSummary().Contains("VS Code GitHub Copilot")) throw new InvalidOperationException("The test PATH command must be detected as VS Code.");
                Console.WriteLine(Program.Json.Serialize(form.SelfTest()));
            }
            return 0;
        }
        catch (Exception error)
        {
            for (var current = error; current != null; current = current.InnerException)
                Console.Error.WriteLine(current.GetType().FullName + ": " + current.Message);
            return 1;
        }
    }
}
