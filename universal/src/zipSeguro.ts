import { unzipSync, Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

/** Fatia de dados compactados entregue de cada vez: o DEFLATE expande no máximo ~1000×, então cada passo gera no máximo ~16 MB. */
const FATIA = 16 * 1024;

/**
 * Lê UMA entrada de um ZIP (KMZ, DOCX…) sem confiar no tamanho que o arquivo declara: descompacta aos poucos e para assim que a saída
 * passa de `limite`. O filtro por tamanho declarado do `unzipSync` é burlável (o ZIP diz “100 bytes” e entrega centenas de MB).
 * Devolve null se a entrada não existe; as demais entradas nunca são descompactadas.
 */
export function lerEntradaLimitada(bytes: Uint8Array, aceita: (nome: string) => boolean, limite: number): Uint8Array | null {
  // “PK”: ZIP com entradas (03 04) ou vazio (05 06); qualquer outra coisa não é um ZIP
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || !((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))) throw new Error('Arquivo compactado inválido ou corrompido.');
  const partes: Uint8Array[] = [];
  let total = 0;
  let achou = false;
  let excedeu = false;
  let erro: Error | null = null;
  const uz = new Unzip((f) => {
    if (achou || !aceita(f.name)) return;
    achou = true;
    f.ondata = (err, chunk) => {
      if (err) {
        erro = err;
        return;
      }
      total += chunk.length;
      if (total > limite) {
        excedeu = true;
        partes.length = 0;
        f.terminate();
      } else partes.push(chunk);
    };
    f.start();
  });
  uz.register(UnzipInflate);
  uz.register(UnzipPassThrough);
  try {
    for (let i = 0; i < bytes.length && !excedeu && !erro; i += FATIA) uz.push(bytes.subarray(i, i + FATIA), i + FATIA >= bytes.length);
  } catch (e) {
    erro = e as Error;
  }
  if (excedeu) throw new Error(`O conteúdo descompactado passa de ${Math.round(limite / 1048576)} MB (o arquivo declara um tamanho menor do que entrega).`);
  if (erro) throw erro;
  if (!achou) return null;
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

/**
 * Confere os tamanhos declarados no diretório do ZIP (sem descompactar nada) antes de entregar o arquivo a uma biblioteca que o abre sozinha (XLSX).
 * Essa biblioteca respeita o tamanho declarado, então uma entrada gigante honesta é o risco real (travar por minutos); uma que mente é cortada.
 */
export function conferirTamanhosDeclarados(bytes: Uint8Array, porEntrada: number, total: number): void {
  let soma = 0;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        soma += f.originalSize;
        if (f.originalSize > porEntrada) throw new Error(`entrada “${f.name}” com ${Math.round(f.originalSize / 1048576)} MB descompactados`);
        return false;
      },
    });
  } catch (e) {
    if ((e as Error).message.startsWith('entrada “')) throw new Error(`Arquivo recusado: ${(e as Error).message} (limite de ${Math.round(porEntrada / 1048576)} MB por parte).`);
    throw new Error('Arquivo compactado inválido ou corrompido.');
  }
  if (soma > total) throw new Error(`Arquivo recusado: ${Math.round(soma / 1048576)} MB descompactados no total (limite de ${Math.round(total / 1048576)} MB).`);
}
