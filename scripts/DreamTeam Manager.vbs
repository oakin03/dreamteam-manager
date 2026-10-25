' Starts DreamTeam Manager (development build) without a console window.
' Used by the desktop shortcut and by the taskbar pin (relaunch command).
' If the app is already running, the new Electron process only brings the open
' window to the front (single-instance lock) and quits.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root

running = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 500, 500, 800, 800
http.Open "GET", "http://127.0.0.1:5173/", False
http.Send
If Err.Number = 0 Then
  If http.Status = 200 Then running = True
End If
On Error GoTo 0

If running Then
  sh.Environment("Process")("VITE_DEV_SERVER_URL") = "http://127.0.0.1:5173"
  sh.Run "cmd /c npx electron .", 0, False
Else
  sh.Run "cmd /c npm run dev", 0, False
End If
