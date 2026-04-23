param(
    [string]$Title = "Select folder",
    [string]$InitialPath = ""
)

# Use the modern Windows File Explorer style folder picker via the native
# IFileDialog COM interface (same one used by Word/Excel/Visual Studio etc.
# for "Open Folder"). The legacy System.Windows.Forms.FolderBrowserDialog
# shows a cramped tree view that looks out of place on Windows 10/11.
#
# Writes the selected absolute path to stdout, or nothing if the user cancels.

$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace NativeFolderPicker
{
    [ComImport, ClassInterface(ClassInterfaceType.None), Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    internal class FileOpenDialog { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        [PreserveSig] int SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        [PreserveSig] int SetFileTypeIndex(uint iFileType);
        [PreserveSig] int GetFileTypeIndex(out uint piFileType);
        [PreserveSig] int Advise(IntPtr pfde, out uint pdwCookie);
        [PreserveSig] int Unadvise(uint dwCookie);
        [PreserveSig] int SetOptions(uint fos);
        [PreserveSig] int GetOptions(out uint fos);
        [PreserveSig] int SetDefaultFolder(IShellItem psi);
        [PreserveSig] int SetFolder(IShellItem psi);
        [PreserveSig] int GetFolder(out IShellItem ppsi);
        [PreserveSig] int GetCurrentSelection(out IShellItem ppsi);
        [PreserveSig] int SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        [PreserveSig] int GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        [PreserveSig] int SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        [PreserveSig] int SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        [PreserveSig] int SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        [PreserveSig] int GetResult(out IShellItem ppsi);
        [PreserveSig] int AddPlace(IShellItem psi, int alignment);
        [PreserveSig] int SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        [PreserveSig] int Close(int hr);
        [PreserveSig] int SetClientGuid(ref Guid guid);
        [PreserveSig] int ClearClientData();
        [PreserveSig] int SetFilter(IntPtr pFilter);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        [PreserveSig] int BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
        [PreserveSig] int GetParent(out IShellItem ppsi);
        [PreserveSig] int GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        [PreserveSig] int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        [PreserveSig] int Compare(IShellItem psi, uint hint, out int piOrder);
    }

    public static class Picker
    {
        private const uint FOS_PICKFOLDERS      = 0x00000020;
        private const uint FOS_FORCEFILESYSTEM  = 0x00000040;
        private const uint FOS_PATHMUSTEXIST    = 0x00000800;
        private const uint SIGDN_FILESYSPATH    = 0x80058000;

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            IntPtr pbc,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            out IShellItem ppv);

        public static string Pick(string title, string initialPath)
        {
            IFileDialog dialog = null;
            try
            {
                dialog = (IFileDialog)(new FileOpenDialog());
            }
            catch (Exception)
            {
                return null;
            }

            uint existingOpts;
            dialog.GetOptions(out existingOpts);
            dialog.SetOptions(existingOpts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);

            if (!string.IsNullOrEmpty(title))
            {
                dialog.SetTitle(title);
            }

            if (!string.IsNullOrEmpty(initialPath))
            {
                try
                {
                    IShellItem initial;
                    Guid iidShellItem = typeof(IShellItem).GUID;
                    int hr = SHCreateItemFromParsingName(initialPath, IntPtr.Zero, iidShellItem, out initial);
                    if (hr == 0 && initial != null)
                    {
                        dialog.SetFolder(initial);
                    }
                }
                catch { /* ignore bad initial path */ }
            }

            int showResult = dialog.Show(IntPtr.Zero);
            if (showResult != 0) return null; // cancelled or error

            IShellItem selected;
            dialog.GetResult(out selected);
            string path;
            selected.GetDisplayName(SIGDN_FILESYSPATH, out path);
            return path;
        }
    }
}
"@

$picked = [NativeFolderPicker.Picker]::Pick($Title, $InitialPath)
if ($picked) { Write-Output $picked }
