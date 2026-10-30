# Instaladores do Dashboard Universal (Windows)

| Arquivo | Tamanho | O que é |
|---|---|---|
| `Instalador-Completo-0.4.0.parte0.bin` + `parte1.bin` + `JUNTAR.bat` | ~108 MB (2 partes) | **Atual.** Programa próprio (Electron) 0.4.0 com painel 0.8.0: menu Arquivo → Abrir, associação de arquivos e **pergunta de atualização ao abrir**. |
| `Instalador-Completo-0.2.0.parte0.bin` + `parte1.bin` + `JUNTAR-0.2.0.bat` | ~106 MB (2 partes) | Versão antiga (0.2.0), mantida só para quem precisar dela. |
| `Instalador-Dashboard-Universal-Leve-0.2.0.exe` | ~0,2 MB | Instala o painel e cria atalhos que o abrem como aplicativo no Edge/Chrome. Não se atualiza sozinho. |

## Instalador completo 0.4.0 (em 2 partes)
1. Baixe `Instalador-Completo-0.4.0.parte0.bin`, `Instalador-Completo-0.4.0.parte1.bin` e `JUNTAR.bat` **na mesma pasta**.
2. Dê dois cliques em `JUNTAR.bat`: ele monta `Instalador-Dashboard-Universal-0.4.0.exe` e confere o SHA-256 (`SHA256SUM.txt`). Se não conferir, apaga o arquivo montado e pede para baixar as partes de novo.
3. Execute o `.exe`. Se aparecer “O Windows protegeu o computador”, clique em **Mais informações → Executar assim mesmo** (o instalador não é assinado digitalmente). Instalar por cima de uma versão anterior atualiza o programa e mantém as associações de arquivo.

As partes existem porque o GitHub não aceita arquivos acima de 100 MB.

## Atualização automática
O **instalador completo** consulta, ao abrir, se há painel novo no GitHub (`universal/atualizacao/`).
- **Programa 0.4.0 ou mais novo:** pergunta “Atualizar agora / Depois” **antes** de baixar. Só com o “sim” baixa, confere o SHA-256, recarrega o painel e reabre o arquivo que estava aberto. “Depois” não guarda nada e a pergunta volta na próxima abertura.
- **Programa 0.3.0 e anteriores:** baixam primeiro e depois perguntam.
- Também há **Ajuda → Verificar atualizações**, e a consulta ao abrir pode ser desligada no mesmo menu.
- Só muda o painel; se a mudança exigir um programa novo, o aplicativo avisa para baixar o instalador de novo. A versão leve **não** se atualiza sozinha: baixe o instalador novamente.
