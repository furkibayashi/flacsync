import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Masaüstü ana süreci backend modüllerini ortam değişkenlerini ayarladıktan SONRA yüklemeli:
 * config/env.ts değerleri içe aktarıldığı anda okur. Statik içe aktarılan bir modül env'i (ve
 * logger'ı) erken yüklerse uygulama geliştirme ayarlarıyla açılır ve paketli sürümde çöker.
 * Yalnızca yan etkisiz, env okumayan modüller statik içe aktarılabilir.
 */
const SAFE = new Set(['utils/download-errors.js', 'utils/sha256sums.js']);

describe('masaüstü → backend içe aktarımları', () => {
  it('yalnızca env okumayan backend modülleri statik içe aktarılır', () => {
    const dir = fileURLToPath(new URL('../../desktop/src/', import.meta.url));
    const bad: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const m of src.matchAll(/^import [^;]*? from '\.\.\/\.\.\/backend\/src\/([^']+)';/gm)) {
        if (!m[0].startsWith('import type') && !SAFE.has(m[1]!)) bad.push(`${file}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('güvenli sayılan modüller gerçekten env / logger içe aktarmıyor', () => {
    for (const mod of SAFE) {
      const src = readFileSync(fileURLToPath(new URL(`../src/${mod.replace(/\.js$/, '.ts')}`, import.meta.url)), 'utf8');
      expect(src).not.toMatch(/config\/env|utils\/logger|from '\.\/logger/);
    }
  });
});
