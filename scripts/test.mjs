#!/usr/bin/env node
/**
 * Run every behavior test in this package (`test/*.test.mjs`) sequentially.
 * Each file is a plain Node script that exits non-zero on failure.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const files = readdirSync(join(root, 'test')).filter(file => file.endsWith('.test.mjs')).sort()
if (files.length === 0) throw new Error('no test/*.test.mjs found')
let failed = 0
for (const file of files) {
  console.log(`\n=== ${file} ===`)
  try {
    execFileSync(process.execPath, [join(root, 'test', file)], { stdio: 'inherit' })
  } catch {
    failed += 1
  }
}
console.log(`\n${files.length - failed}/${files.length} test file(s) passed`)
process.exit(failed === 0 ? 0 : 1)
