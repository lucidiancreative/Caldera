; Caldera – Inno Setup Installer Script
; Requires: Inno Setup 6.x  (https://jrsoftware.org/isinfo.php)
;
; Workflow:
;   1. npm run dist:win          <- builds dist\win-unpacked\
;   2. Open this file in Inno Setup Compiler and press Compile (Ctrl+F9)
;   3. Installer is written to installer\Caldera-Setup-1.1.0.exe

#define AppName      "Caldera"
#define AppVersion   "1.1.0"
#define AppPublisher "Lucidian Creative"
#define AppURL       "https://github.com/lucidiancreative/Caldera"
#define AppExeName   "Caldera.exe"
#define SrcDir       "dist\win-unpacked"

[Setup]
AppId={{E7A3F2C1-4D8B-4A9E-B6F0-2C1D3E5F7A9B}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=installer
OutputBaseFilename=Caldera-Setup-{#AppVersion}
SetupIconFile=build\setup-icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Require 64-bit Windows (Electron is 64-bit)
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
; Minimum Windows 10
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Copy everything from win-unpacked recursively
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu shortcut
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"
; Desktop shortcut (optional – user selects during install)
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon
; Uninstall shortcut in Start Menu
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; Offer to launch after install
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
