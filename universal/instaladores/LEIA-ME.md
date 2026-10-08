# Instaladores do Dashboard Universal (Windows)

| Arquivo | Tamanho | O que é |
|---|---|---|
| `Instalador-Dashboard-Universal-Leve-0.1.0.exe` | ~0,2 MB | Instala o painel e cria atalhos que o abrem como aplicativo no Edge/Chrome. |
| `Instalador-Completo-0.1.0.parte0.bin` + `parte1.bin` + `JUNTAR.bat` | ~106 MB (2 partes) | Programa próprio (Electron): menu Arquivo → Abrir e associação de arquivos. |

## Instalador completo (em 2 partes)
1. Baixe `parte0.bin`, `parte1.bin` e `JUNTAR.bat` **na mesma pasta**.
2. Dê dois cliques em `JUNTAR.bat`: ele monta `Instalador-Dashboard-Universal-0.1.0.exe` e confere o SHA-256 (`SHA256SUM.txt`).
3. Execute o `.exe`. Se aparecer “O Windows protegeu o computador”, clique em **Mais informações → Executar assim mesmo** (o instalador não é assinado digitalmente).

As partes existem porque o GitHub não aceita arquivos acima de 100 MB.
