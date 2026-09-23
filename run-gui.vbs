Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

If Not fso.FileExists(fso.BuildPath(here, "settings.json")) Then
  sh.Run "cmd /c """"" & fso.BuildPath(here, "run.bat") & """""", 1, True
  If Not fso.FileExists(fso.BuildPath(here, "settings.json")) Then WScript.Quit
End If

Do
  sh.Run "cmd /c node start.mjs", 0, True
  WScript.Sleep 5000
Loop
