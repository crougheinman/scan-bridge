' Starts the Scan Bridge with NO console window. Used by the scheduled task.
' Output goes to bridge.log next to this file.
' Waits (True) so the scheduled task stays "running" while the bridge runs --
' that is what stops the 5-minute re-trigger from starting a second copy.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
q = Chr(34)
sh.Run "cmd /c " & q & q & dir & "\start-scan-bridge.bat" & q & " /auto >> " & q & dir & "\bridge.log" & q & " 2>&1" & q, 0, True
