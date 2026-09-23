Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

packed = fso.BuildPath(here, "app-win\DDNet AI.exe")
stamp = fso.BuildPath(here, "app-win\.installed")
dev = fso.BuildPath(here, "app\node_modules\electron\dist\electron.exe")

Function ReadText(p)
  ReadText = ""
  If Not fso.FileExists(p) Then Exit Function
  If fso.GetFile(p).Size = 0 Then Exit Function
  ReadText = fso.OpenTextFile(p, 1).ReadAll
End Function

Function WantedElectron()
  WantedElectron = ""
  Set re = New RegExp
  re.Pattern = """electron""\s*:\s*""([0-9.]+)"""
  Set m = re.Execute(ReadText(fso.BuildPath(here, "app\package.json")))
  If m.Count > 0 Then WantedElectron = m(0).SubMatches(0)
End Function

need = WantedElectron()
installed = Trim(Replace(Replace(ReadText(stamp), vbCr, ""), vbLf, ""))
stale = Not fso.FileExists(packed) Or (need <> "" And installed <> need)

If stale And Not fso.FileExists(dev) Then
  If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
    MsgBox "DDNet AI needs Node.js (18 or newer) once, to set up its window." & vbCrLf & _
      "Install it from https://nodejs.org and double-click DDNet AI.vbs again.", vbExclamation, "DDNet AI"
    If Not fso.FileExists(packed) Then WScript.Quit 1
  Else
    rc = sh.Run("cmd /c ""title DDNet AI: installing the window && node tools\packageApp.mjs --install || (echo. && echo Setup failed, see above. && pause && exit /b 1)""", 1, True)
    If rc <> 0 And Not fso.FileExists(packed) Then WScript.Quit 1
  End If
End If

If fso.FileExists(packed) Then
  sh.Run """" & packed & """", 1, False
ElseIf fso.FileExists(dev) Then
  sh.Run """" & dev & """ app", 1, False
Else
  MsgBox "The DDNet AI window is not installed yet." & vbCrLf & _
    "Double-click DDNet AI.vbs again with an internet connection to set it up.", vbExclamation, "DDNet AI"
End If
