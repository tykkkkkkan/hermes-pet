' 生成 Hermes 桌宠桌面快捷方式
Set ws = CreateObject("WScript.Shell")
desktop = ws.SpecialFolders("Desktop")
Set lnk = ws.CreateShortcut(desktop & "\Hermes 桌宠.lnk")
lnk.TargetPath = "D:\01-项目\hermes-pet\node_modules\electron\dist\electron.exe"
lnk.Arguments = "."
lnk.WorkingDirectory = "D:\01-项目\hermes-pet"
lnk.IconLocation = "D:\01-项目\hermes-pet\assets\hermes-pet.ico,0"
lnk.Description = "Hermes 桌宠"
lnk.WindowStyle = 1
lnk.Save
WScript.Echo "shortcut created: " & desktop & "\Hermes 桌宠.lnk"
