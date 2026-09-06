using System;
using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace OpenClawSetup
{
    public partial class App : System.Windows.Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            DispatcherUnhandledException += (_, args) =>
            {
                Log("dispatcher: " + args.Exception);
                System.Windows.MessageBox.Show("Ошибка: " + args.Exception.Message + "\n\n" + args.Exception,
                    "OpenClaw Setup", MessageBoxButton.OK, MessageBoxImage.Error);
                args.Handled = true;
            };
            AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            {
                Log("appdomain: " + args.ExceptionObject);
            };
            Log("app: started");
        }

        internal static void Log(string msg)
        {
            try
            {
                var paths = new[]
                {
                    Path.Combine(Path.GetTempPath(), "OpenClawSetup", "crash.log"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OpenClawSetup", "crash.log")
                };
                foreach (var f in paths)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(f)!);
                    File.AppendAllText(f, "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + "\n");
                }
            }
            catch { }
        }
    }
}
