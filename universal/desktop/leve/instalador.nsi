; Instalador leve do Dashboard Universal: instala o painel (um único HTML) e cria atalhos que o abrem
; como aplicativo (Microsoft Edge em modo "app", já presente no Windows 10/11).
Unicode true
!include "MUI2.nsh"
!include "StrFunc.nsh"
${StrRep}

!define NOME "Dashboard Universal"
!ifndef VERSAO
  !define VERSAO "0.1.0"
!endif
!ifndef SAIDA
  !define SAIDA "Instalador-Dashboard-Universal-Leve-${VERSAO}.exe"
!endif

Name "${NOME}"
OutFile "${SAIDA}"
InstallDir "$LOCALAPPDATA\Programs\${NOME}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirPrograma
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${NOME} agora"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Var Edge
Var UrlApp

Function ProcurarEdge
  StrCpy $Edge ""
  IfFileExists "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe" 0 +3
    StrCpy $Edge "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
    Return
  IfFileExists "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe" 0 +3
    StrCpy $Edge "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
    Return
  IfFileExists "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe" 0 +3
    StrCpy $Edge "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
    Return
  IfFileExists "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe" 0 +2
    StrCpy $Edge "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
FunctionEnd

Function AbrirPrograma
  ExecShell "open" "$SMPROGRAMS\${NOME}.lnk"
FunctionEnd

Section "Instalar"
  SetOutPath "$INSTDIR"
  File "index.html"
  File "icon.ico"
  Call ProcurarEdge
  ${StrRep} $UrlApp "$INSTDIR\index.html" "\" "/"
  ${If} $Edge != ""
    CreateShortCut "$SMPROGRAMS\${NOME}.lnk" "$Edge" '--app="file:///$UrlApp"' "$INSTDIR\icon.ico"
    CreateShortCut "$DESKTOP\${NOME}.lnk" "$Edge" '--app="file:///$UrlApp"' "$INSTDIR\icon.ico"
  ${Else}
    ; sem Edge/Chrome: abre no navegador padrão
    CreateShortCut "$SMPROGRAMS\${NOME}.lnk" "$INSTDIR\index.html" "" "$INSTDIR\icon.ico"
    CreateShortCut "$DESKTOP\${NOME}.lnk" "$INSTDIR\index.html" "" "$INSTDIR\icon.ico"
  ${EndIf}
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOME}" "DisplayName" "${NOME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOME}" "DisplayVersion" "${VERSAO}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOME}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOME}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOME}" "NoModify" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${NOME}.lnk"
  Delete "$DESKTOP\${NOME}.lnk"
  Delete "$INSTDIR\index.html"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOME}"
SectionEnd
