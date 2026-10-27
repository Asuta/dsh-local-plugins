#!/usr/bin/env node
/**
 * Read the DSH Desktop application archive.
 *
 * DSH's own packages live inside resources/app.asar, which shell tools, ripgrep's
 * directory walk, node's require and pnpm cannot open as files. This script
 * parses the archive header and reads entries directly.
 *
 *   node asar.mjs ls <prefix>
 *   node asar.mjs read <path-inside-archive>
 *   node asar.mjs grep <regex> [--max <hits>] [--context <chars>]
 *
 * The archive defaults to the installed DSH app; override with --asar <file> or
 * the DSH_ASAR environment variable.
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_ASAR = 'D:/SoftWare/dsh/resources/app.asar'

function parseArgs(argv) {
  const args = { _: [], max: 5, context: 400, asar: process.env.DSH_ASAR || DEFAULT_ASAR }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--max' || token === '--context' || token === '--asar') {
      args[token.slice(2)] = token === '--asar' ? argv[++i] : Number(argv[++i])
    } else {
      args._.push(token)
    }
  }
  return args
}

function openArchive(file) {
  const fd = fs.openSync(file, 'r')
  const sizeBuf = Buffer.alloc(8)
  fs.readSync(fd, sizeBuf, 0, 8, 0)
  // The header is a pickle: [uint32 payloadSize][uint32 stringLength][json…].
  const payloadSize = sizeBuf.readUInt32LE(4)
  const headerBuf = Buffer.alloc(payloadSize)
  fs.readSync(fd, headerBuf, 0, payloadSize, 8)
  const stringLength = headerBuf.readUInt32LE(4)
  const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + stringLength))
  const dataStart = 8 + payloadSize
  return { fd, header, dataStart }
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const full = prefix ? prefix + '/' + name : name
    if (entry.files) walk(entry, full, out)
    else out.push({ path: full, ...entry })
  }
  return out
}

function readEntry(archive, target) {
  let node = archive.header
  for (const segment of target.split('/').filter(Boolean)) {
    node = node.files?.[segment]
    if (!node) return null
  }
  if (!node || node.files) return null
  if (node.unpacked) return { unpacked: true }
  const size = Number(node.size)
  const buf = Buffer.alloc(size)
  fs.readSync(archive.fd, buf, 0, size, archive.dataStart + Number(node.offset))
  return buf
}

const args = parseArgs(process.argv.slice(2))
const [command, argument] = args._

if (!command || !argument) {
  process.stderr.write('usage: asar.mjs <ls|read|grep> <prefix|path|regex> [--max N] [--context N] [--asar FILE]\n')
  process.exit(2)
}

const archive = openArchive(args.asar)

if (command === 'ls') {
  const entries = walk(archive.header, '', []).filter((e) => e.path.startsWith(argument))
  for (const entry of entries.slice(0, 400)) process.stdout.write(entry.path + '\n')
  if (entries.length > 400) process.stdout.write('... ' + (entries.length - 400) + ' more\n')
} else if (command === 'read') {
  const buf = readEntry(archive, argument)
  if (!buf) {
    process.stderr.write('not found: ' + argument + '\n')
    process.exit(1)
  }
  if (!Buffer.isBuffer(buf)) {
    process.stderr.write('stored outside the archive; read it from ' +
      path.join(path.dirname(args.asar), 'app.asar.unpacked', argument) + '\n')
    process.exit(1)
  }
  process.stdout.write(buf)
} else if (command === 'grep') {
  const pattern = new RegExp(argument, 'g')
  const entries = walk(archive.header, '', []).filter((e) => /\.(js|mjs|cjs|json|d\.ts|ts)$/.test(e.path))
  let hits = 0
  for (const entry of entries) {
    const buf = readEntry(archive, entry.path)
    if (!buf || !Buffer.isBuffer(buf)) continue
    if (buf.includes(0)) continue
    const text = buf.toString('utf8')
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) && hits < args.max) {
      hits++
      const start = Math.max(0, match.index - args.context / 2)
      const chunk = text.slice(start, start + args.context)
      process.stdout.write('\n===== ' + entry.path + ' @' + match.index + ' =====\n' + chunk + '\n')
    }
    if (hits >= args.max) break
  }
  if (hits === 0) process.stdout.write('(no hit)\n')
}
